"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  ROLES_DUENO,
  ROLES_COMPROBANTE,
  ROLES_EDICION,
  requireAcceso,
  registrarBitacora,
  siguienteNumeroLote,
  puede,
  alcanzaEmpresa,
  motivoNoLiberable,
} from "@/lib/tesoreria";
import { formatMoney } from "@/lib/money";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safe = ["Tu rol", "No tenés", "Movimiento", "Planilla", "Lote", "No se puede", "Seleccioná"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible completar la operación" };
}

/** Carga los movimientos verificando que sean todos de la misma empresa. */
async function cargarMovimientos(ids: string[]) {
  if (ids.length === 0) throw new Error("Seleccioná al menos un pago");
  const movimientos = await prisma.bankMovement.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, estado: true, debit: true, credit: true, reference: true,
      sheet: { select: { companyId: true, name: true } },
    },
  });
  if (movimientos.length !== ids.length) throw new Error("Movimiento no encontrado");
  const empresas = new Set(movimientos.map((m) => m.sheet.companyId));
  if (empresas.size > 1) throw new Error("No se puede liberar pagos de distintas empresas en un mismo lote");
  return { movimientos, companyId: [...empresas][0] };
}


const montoDe = (m: { debit: unknown; credit: unknown }) => {
  const d = Number(String(m.debit ?? 0));
  const c = Number(String(m.credit ?? 0));
  return Math.abs(d) || Math.abs(c);
};

// ═══════════════ 1) Guido (dueño) libera ═══════════════

/**
 * Libera uno o varios pagos y los agrupa en un LOTE. El lote es la unidad de
 * trabajo de la administradora: un comprobante y una confirmación por lote,
 * y de él sale el Excel de nómina bancaria.
 */
export async function liberarPagos(movementIds: string[], nota?: string): Promise<Result<{ batchId: string; numero: number }>> {
  try {
    const { movimientos, companyId } = await cargarMovimientos(movementIds);
    const user = await requireAcceso(companyId, ROLES_DUENO);

    const yaLiberados = movimientos.filter((m) => m.estado !== "PENDIENTE");
    if (yaLiberados.length > 0) {
      throw new Error(`No se puede liberar: ${yaLiberados.length} pago(s) ya están en el circuito`);
    }

    const noLiberables = movimientos
      .map((m) => motivoNoLiberable(m))
      .filter((x): x is string => x !== null);
    if (noLiberables.length > 0) {
      throw new Error(`No se puede liberar: ${noLiberables[0]}`);
    }

    const numero = await siguienteNumeroLote(companyId);
    const total = movimientos.reduce((a, m) => a + montoDe(m), 0);

    const batch = await prisma.$transaction(async (tx) => {
      const lote = await tx.transferBatch.create({
        data: {
          companyId,
          number: numero,
          status: "LIBERADO",
          note: nota?.trim() || null,
          releasedById: user.id,
        },
      });
      await tx.bankMovement.updateMany({
        where: { id: { in: movementIds } },
        data: {
          estado: "LIBERADO",
          released: true,
          releasedAt: new Date(),
          releasedById: user.id,
          batchId: lote.id,
        },
      });
      await registrarBitacora(tx, {
        companyId,
        actorUserId: user.id,
        action: "LIBERADO",
        batchId: lote.id,
        detail: `LOTE-${String(numero).padStart(3, "0")}: ${movimientos.length} pago(s) por ${formatMoney(String(total), "CLP")}`,
      });
      for (const m of movimientos) {
        await registrarBitacora(tx, {
          companyId,
          actorUserId: user.id,
          action: "LIBERADO",
          movementId: m.id,
          batchId: lote.id,
          detail: `${m.reference ?? "sin referencia"} · ${formatMoney(String(montoDe(m)), "CLP")}`,
        });
      }
      return lote;
    });

    revalidatePath("/bancos");
    return { ok: true, batchId: batch.id, numero };
  } catch (error) {
    return failure(error) as Result<{ batchId: string; numero: number }>;
  }
}

/** Deshacer la liberación (solo dueño, solo si aún no hay comprobante). */
export async function deshacerLiberacion(batchId: string): Promise<Result> {
  try {
    const lote = await prisma.transferBatch.findUnique({
      where: { id: batchId },
      select: { id: true, companyId: true, number: true, status: true },
    });
    if (!lote) throw new Error("Lote no encontrado");
    const user = await requireAcceso(lote.companyId, ROLES_DUENO);
    if (lote.status !== "LIBERADO") {
      throw new Error("No se puede deshacer: el lote ya tiene comprobante o fue transferido");
    }

    await prisma.$transaction(async (tx) => {
      await tx.bankMovement.updateMany({
        where: { batchId },
        data: { estado: "PENDIENTE", released: false, releasedAt: null, releasedById: null, batchId: null },
      });
      await registrarBitacora(tx, {
        companyId: lote.companyId,
        actorUserId: user.id,
        action: "LIBERACION_DESHECHA",
        batchId: lote.id,
        detail: `LOTE-${String(lote.number).padStart(3, "0")} devuelto a pendiente`,
      });
      await tx.transferBatch.delete({ where: { id: batchId } });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ═══════════════ 2) Vicky (administradora) sube la transferencia ═══════════════

export async function registrarComprobante(batchId: string, fileName: string): Promise<Result> {
  try {
    const nombre = z.string().trim().min(1, "Falta el nombre del archivo").max(300).parse(fileName);
    const lote = await prisma.transferBatch.findUnique({
      where: { id: batchId },
      select: { id: true, companyId: true, number: true, status: true },
    });
    if (!lote) throw new Error("Lote no encontrado");
    const user = await requireAcceso(lote.companyId, ROLES_COMPROBANTE);
    if (lote.status === "TRANSFERIDO") {
      throw new Error("No se puede cambiar el comprobante de un lote ya transferido");
    }

    await prisma.$transaction(async (tx) => {
      await tx.transferBatch.update({
        where: { id: batchId },
        data: {
          status: "COMPROBANTE_SUBIDO",
          proofFileName: nombre,
          proofUploadedAt: new Date(),
          proofUploadedById: user.id,
        },
      });
      await tx.bankMovement.updateMany({
        where: { batchId },
        data: { estado: "EN_TRANSFERENCIA" },
      });
      await registrarBitacora(tx, {
        companyId: lote.companyId,
        actorUserId: user.id,
        action: "COMPROBANTE_SUBIDO",
        batchId: lote.id,
        detail: `LOTE-${String(lote.number).padStart(3, "0")} · ${nombre}`,
      });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ═══════════════ 3) Guido (dueño) marca transferida ═══════════════

export async function marcarTransferida(batchId: string): Promise<Result> {
  try {
    const lote = await prisma.transferBatch.findUnique({
      where: { id: batchId },
      select: { id: true, companyId: true, number: true, status: true, proofFileName: true },
    });
    if (!lote) throw new Error("Lote no encontrado");
    const user = await requireAcceso(lote.companyId, ROLES_DUENO);
    if (lote.status === "LIBERADO" || !lote.proofFileName) {
      throw new Error("No se puede marcar transferida sin el comprobante de la administradora");
    }
    if (lote.status === "TRANSFERIDO") throw new Error("El lote ya está transferido");

    await prisma.$transaction(async (tx) => {
      await tx.transferBatch.update({
        where: { id: batchId },
        data: { status: "TRANSFERIDO", transferredAt: new Date(), transferredById: user.id },
      });
      await tx.bankMovement.updateMany({ where: { batchId }, data: { estado: "TRANSFERIDO" } });
      await registrarBitacora(tx, {
        companyId: lote.companyId,
        actorUserId: user.id,
        action: "TRANSFERIDO",
        batchId: lote.id,
        detail: `LOTE-${String(lote.number).padStart(3, "0")} confirmado como transferido`,
      });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function revertirTransferencia(batchId: string): Promise<Result> {
  try {
    const lote = await prisma.transferBatch.findUnique({
      where: { id: batchId },
      select: { id: true, companyId: true, number: true, status: true },
    });
    if (!lote) throw new Error("Lote no encontrado");
    const user = await requireAcceso(lote.companyId, ROLES_DUENO);
    if (lote.status !== "TRANSFERIDO") throw new Error("El lote no está transferido");

    await prisma.$transaction(async (tx) => {
      await tx.transferBatch.update({
        where: { id: batchId },
        data: { status: "COMPROBANTE_SUBIDO", transferredAt: null, transferredById: null },
      });
      await tx.bankMovement.updateMany({ where: { batchId }, data: { estado: "EN_TRANSFERENCIA" } });
      await registrarBitacora(tx, {
        companyId: lote.companyId,
        actorUserId: user.id,
        action: "TRANSFERENCIA_REVERTIDA",
        batchId: lote.id,
        detail: `LOTE-${String(lote.number).padStart(3, "0")} revertido a "en transferencia"`,
      });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ═══════════════ Edición de movimientos ═══════════════

const movimientoSchema = z.object({
  reference: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  debit: z.union([z.string(), z.number()]).optional(),
  credit: z.union([z.string(), z.number()]).optional(),
  rut: z.string().trim().max(20).nullable().optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  accountNumber: z.string().trim().max(40).nullable().optional(),
  accountType: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  categoryGeneral: z.string().trim().max(80).nullable().optional(),
  businessCenter: z.string().trim().max(80).nullable().optional(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable().optional(),
});

const ETIQUETA_CAMPO: Record<string, string> = {
  reference: "referencia", description: "descripción", debit: "egreso", credit: "abono",
  rut: "RUT", bankName: "banco", accountNumber: "n° cuenta", accountType: "tipo de cuenta",
  email: "correo", categoryGeneral: "categoría", businessCenter: "centro de negocio", date: "fecha",
};

const normalizarMonto = (v: unknown): string => {
  const raw = String(v ?? "").trim().replace(/\$|\s/g, "");
  if (raw === "") return "0";
  const norm = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/\.(?=\d{3}\b)/g, "");
  const n = Number(norm);
  return Number.isFinite(n) ? Math.abs(n).toFixed(2) : "0";
};

/** Edita un movimiento y deja en la bitácora cada campo con su valor anterior. */
export async function editarMovimiento(movementId: string, data: unknown): Promise<Result> {
  try {
    const actual = await prisma.bankMovement.findUnique({
      where: { id: movementId },
      include: { sheet: { select: { companyId: true } } },
    });
    if (!actual) throw new Error("Movimiento no encontrado");
    const user = await requireAcceso(actual.sheet.companyId, ROLES_EDICION);

    // Un pago ya transferido solo lo corrige el dueño, y queda marcado como corrección.
    if (actual.estado === "TRANSFERIDO" && !puede(user, ROLES_DUENO)) {
      throw new Error("No se puede editar un pago ya transferido; pedile la corrección al dueño");
    }

    const parsed = movimientoSchema.parse(data);
    const cambios: string[] = [];
    const update: Record<string, unknown> = {};

    for (const [campo, valor] of Object.entries(parsed)) {
      if (valor === undefined) continue;
      if (campo === "debit" || campo === "credit") {
        const nuevo = normalizarMonto(valor);
        const anterior = String(actual[campo as "debit" | "credit"]);
        if (Number(nuevo) !== Number(anterior)) {
          update[campo] = nuevo;
          cambios.push(`${ETIQUETA_CAMPO[campo]}: ${formatMoney(anterior, "CLP")} → ${formatMoney(nuevo, "CLP")}`);
        }
        continue;
      }
      if (campo === "date") {
        const nuevo = valor ? new Date(`${valor}T12:00:00Z`) : null;
        const anterior = actual.date;
        if (nuevo?.toISOString().slice(0, 10) !== anterior?.toISOString().slice(0, 10)) {
          update.date = nuevo;
          cambios.push(`${ETIQUETA_CAMPO.date}: ${anterior?.toISOString().slice(0, 10) ?? "—"} → ${valor ?? "—"}`);
        }
        continue;
      }
      const nuevo = valor === "" ? null : (valor as string | null);
      const anterior = (actual as unknown as Record<string, string | null>)[campo] ?? null;
      if (nuevo !== anterior) {
        update[campo] = nuevo;
        cambios.push(`${ETIQUETA_CAMPO[campo] ?? campo}: ${anterior ?? "—"} → ${nuevo ?? "—"}`);
      }
    }

    if (cambios.length === 0) return { ok: true };

    await prisma.$transaction(async (tx) => {
      await tx.bankMovement.update({ where: { id: movementId }, data: update });
      await registrarBitacora(tx, {
        companyId: actual.sheet.companyId,
        actorUserId: user.id,
        action: "MOVIMIENTO_EDITADO",
        movementId,
        detail: (actual.estado === "TRANSFERIDO" ? "CORRECCIÓN sobre pago transferido — " : "") + cambios.join(" · "),
      });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ═══════════════ Planillas ═══════════════

export async function deleteSheet(sheetId: string): Promise<Result> {
  try {
    const sheet = await prisma.bankSheet.findUnique({
      where: { id: sheetId },
      select: { id: true, companyId: true, name: true },
    });
    if (!sheet) throw new Error("Planilla no encontrada");
    const user = await requireUser();
    if (!puede(user, ROLES_EDICION) || !alcanzaEmpresa(user, sheet.companyId)) {
      throw new Error("Tu rol no permite eliminar planillas de esta empresa");
    }

    await prisma.$transaction(async (tx) => {
      await registrarBitacora(tx, {
        companyId: sheet.companyId,
        actorUserId: user.id,
        action: "PLANILLA_ELIMINADA",
        detail: sheet.name,
      });
      await tx.bankSheet.delete({ where: { id: sheetId } });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
