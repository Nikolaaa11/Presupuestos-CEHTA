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
import { parsearMonto, PLANILLA_MANUAL } from "@/lib/tesoreria-core";
import { dec, formatMoney } from "@/lib/money";

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
      id: true, estado: true, debit: true, credit: true, reference: true, createdById: true,
      date: true, // la fila de totales de la planilla no tiene fecha: así se reconoce
      sheet: { select: { companyId: true, name: true } },
    },
  });
  if (movimientos.length !== ids.length) throw new Error("Movimiento no encontrado");
  const empresas = new Set(movimientos.map((m) => m.sheet.companyId));
  if (empresas.size > 1) throw new Error("No se puede liberar pagos de distintas empresas en un mismo lote");
  return { movimientos, companyId: [...empresas][0] };
}

/** Monto del movimiento con Decimal — jamás aritmética float sobre plata. */
const montoDe = (m: { debit: unknown; credit: unknown }) => {
  const d = dec(String(m.debit ?? 0)).abs();
  return d.isZero() ? dec(String(m.credit ?? 0)).abs() : d;
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

    // Cuatro ojos sobre las cargas manuales: quien ORIGINA una obligación de
    // pago no puede ser quien la autoriza. Sin excepción para FUND_ADMIN, igual
    // que el guard de revisión/aprobación del presupuesto — si el mismo rol
    // pudiera saltárselo, el control no existe.
    const propios = movimientos.filter((m) => m.createdById && m.createdById === user.id);
    if (propios.length > 0) {
      throw new Error(
        `No se puede liberar un movimiento que cargaste vos mismo (${propios[0].reference ?? "sin referencia"}): la liberación la firma otra persona`,
      );
    }

    const numero = await siguienteNumeroLote(companyId);
    const total = movimientos.reduce((a, m) => a.plus(montoDe(m)), dec(0));

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

// ═══════════════ Alta manual de movimientos ═══════════════

/** No es un nombre de archivo: que nadie salga a buscar un Excel que no existe. */
const ORIGEN_MANUAL = "Carga manual (sin archivo)";

/** Normaliza una referencia para comparar: "OC 0017", "oc0017" y "OC0017" son la misma. */
const claveReferencia = (r: string) => r.trim().replace(/\s+/g, " ").toUpperCase();

const altaSchema = z
  .object({
    companyCode: z.string().trim().min(1, "Falta la empresa").max(20),
    tipo: z.enum(["EGRESO", "ABONO"], { message: "Elegí si es un egreso a pagar o un abono recibido" }),
    monto: z.union([z.string(), z.number()]),
    date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Poné la fecha del movimiento"),
    reference: z.string().trim().max(200).optional(),
    description: z.string().trim().max(500).optional(),
    rut: z.string().trim().max(20).optional(),
    bankName: z.string().trim().max(80).optional(),
    accountNumber: z.string().trim().max(40).optional(),
    accountType: z.string().trim().max(40).optional(),
    email: z.string().trim().max(120).optional(),
    categoryGeneral: z.string().trim().max(80).optional(),
    businessCenter: z.string().trim().max(80).optional(),
    confirmarDuplicado: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    // El monto se valida ACÁ y no en el cuerpo del action para que el mensaje
    // salga por la rama ZodError de failure() y llegue textual al usuario: un
    // Error() común se convierte en "No fue posible completar la operación".
    const leido = parsearMonto(v.monto);
    if (!leido.ok) {
      ctx.addIssue({ code: "custom", path: ["monto"], message: leido.motivo });
      return;
    }
    if (dec(leido.valor).lte(0)) {
      ctx.addIssue({ code: "custom", path: ["monto"], message: "El monto tiene que ser mayor que cero" });
    }
    // Sin referencia el banco recibe la transferencia sin nombre de
    // beneficiario (columna G del formato Santander) y la fila no se agrupa en
    // «Abonos por referencia». En un abono recibido es menos grave, pero igual
    // sirve para reconocerlo.
    if (v.tipo === "EGRESO" && !v.reference) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Poné a quién se le paga: es el nombre que va en la nómina del banco",
      });
    }
  });

export type Duplicado = { referencia: string; monto: string; fecha: string | null; planilla: string; estado: string };

type ResultadoAlta =
  | { ok: true; sheetId: string; movementId: string }
  | { ok: false; error: string; duplicados?: Duplicado[] };

/**
 * La planilla de cargas manuales de la empresa, creada la primera vez.
 * El id es determinístico (`manual_<companyId>`) para que el alta sea idempotente
 * sobre la clave primaria: dos altas simultáneas no pueden crear dos planillas
 * homónimas — que además rompían la descarga por empresa, porque un libro Excel
 * no admite dos hojas con el mismo nombre.
 */
async function planillaManual(companyId: string) {
  const id = `manual_${companyId}`;
  try {
    return await prisma.bankSheet.upsert({
      where: { id },
      create: { id, companyId, name: PLANILLA_MANUAL, sourceFile: ORIGEN_MANUAL, manual: true },
      update: {},
    });
  } catch {
    // Carrera perdida: la creó la otra transacción. Leerla es el resultado correcto.
    return await prisma.bankSheet.findUniqueOrThrow({ where: { id } });
  }
}

/**
 * Agrega un movimiento a mano: lo que llega fuera de la cartola (una factura
 * suelta, un pago que todavía no aparece en el banco, un abono recibido).
 *
 * Entra al circuito como cualquier otro: nace PENDIENTE, se puede liberar,
 * sale en la nómina y queda en la bitácora. Lo que NO se puede es nacer ya
 * liberado o transferido — eso sería registrar un pago que nadie autorizó.
 */
export async function agregarMovimiento(data: unknown): Promise<ResultadoAlta> {
  try {
    const v = altaSchema.parse(data);

    // La empresa se resuelve en el servidor a partir del código, y el sheetId
    // NUNCA viene del cliente: si el action aceptara los dos, un encargado
    // podría colgar su movimiento de la planilla de otra empresa.
    const company = await prisma.company.findUnique({
      where: { code: v.companyCode.toUpperCase() },
      select: { id: true, code: true },
    });
    if (!company) throw new Error("No se encontró la empresa");
    const user = await requireAcceso(company.id, ROLES_EDICION);

    const leido = parsearMonto(v.monto);
    if (!leido.ok) throw new Error("No se puede guardar: el monto no se entiende");
    const monto = leido.valor;
    const esEgreso = v.tipo === "EGRESO";

    // Duplicado: el error caro no es el doble clic, es cargar a mano un pago
    // que después llega por cartola. Por eso se compara por empresa +
    // referencia + monto, SIN exigir la misma fecha. Nunca bloquea: avisa.
    if (v.reference && !v.confirmarDuplicado) {
      const clave = claveReferencia(v.reference);
      const candidatos = await prisma.bankMovement.findMany({
        where: {
          sheet: { companyId: company.id },
          ...(esEgreso ? { debit: monto } : { credit: monto }),
        },
        select: {
          reference: true, debit: true, credit: true, date: true, estado: true,
          sheet: { select: { name: true } },
        },
        take: 200,
      });
      const duplicados = candidatos
        .filter((c) => c.reference && claveReferencia(c.reference) === clave)
        .slice(0, 5)
        .map((c) => ({
          referencia: c.reference ?? "—",
          monto: formatMoney(esEgreso ? c.debit : c.credit, "CLP"),
          fecha: c.date ? c.date.toISOString().slice(0, 10) : null,
          planilla: c.sheet.name,
          estado: c.estado,
        }));
      if (duplicados.length > 0) {
        return {
          ok: false,
          error: `Ya hay ${duplicados.length === 1 ? "un movimiento" : `${duplicados.length} movimientos`} con esa referencia y ese monto en ${company.code}. Revisá que no sea el mismo antes de agregarlo de nuevo.`,
          duplicados,
        };
      }
    }

    const sheet = await planillaManual(company.id);
    const vacioANull = (s?: string) => (s && s.trim() !== "" ? s.trim() : null);

    const movimiento = await prisma.$transaction(async (tx) => {
      const ultimo = await tx.bankMovement.aggregate({
        where: { sheetId: sheet.id },
        _max: { rowIndex: true },
      });
      const creado = await tx.bankMovement.create({
        data: {
          sheetId: sheet.id,
          rowIndex: (ultimo._max.rowIndex ?? 0) + 1,
          date: new Date(`${v.date}T12:00:00Z`),
          reference: vacioANull(v.reference),
          description: vacioANull(v.description),
          // Excluyentes por construcción: el tipo decide cuál lleva el monto y
          // el otro queda en cero. Una fila con débito y crédito a la vez es
          // una particularidad del registro de OCs, no algo que se cargue a mano.
          debit: esEgreso ? monto : "0",
          credit: esEgreso ? "0" : monto,
          rut: vacioANull(v.rut),
          bankName: vacioANull(v.bankName),
          accountNumber: vacioANull(v.accountNumber),
          accountType: vacioANull(v.accountType),
          email: vacioANull(v.email),
          categoryGeneral: vacioANull(v.categoryGeneral),
          businessCenter: vacioANull(v.businessCenter),
          createdById: user.id,
          // estado / released / batchId NO se aceptan del cliente: nacen en su
          // valor por defecto (PENDIENTE, false, null).
        },
        select: { id: true },
      });
      await registrarBitacora(tx, {
        companyId: company.id,
        actorUserId: user.id,
        action: "MOVIMIENTO_AGREGADO",
        movementId: creado.id,
        // Autosuficiente: el evento sobrevive a la fila (FK SetNull) y tiene que
        // seguir diciendo qué se cargó sin ella. Monto exacto Y formateado,
        // porque formatMoney redondea los centavos para mostrar.
        detail: `${esEgreso ? "Egreso a pagar" : "Abono recibido"} · ${v.reference ?? "sin referencia"} · ${formatMoney(monto, "CLP")} (${monto}) · fecha ${v.date}`,
      });
      return creado;
    });

    revalidatePath("/bancos");
    return { ok: true, sheetId: sheet.id, movementId: movimiento.id };
  } catch (error) {
    return failure(error) as ResultadoAlta;
  }
}

// ═══════════════ Edición de movimientos ═══════════════

const movimientoSchema = z
  .object({
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
// Los montos NO se validan acá sino en el cuerpo de `editarMovimiento`, donde
// se conoce el valor guardado. Validar a ciegas rompía dos cosas reales:
//   - Vaciar el campo (la forma natural de poner cero, y el editor manda
//     SIEMPRE los dos montos) tiraba abajo la edición entera —incluidos los
//     cambios de RUT o cuenta— con un «Escribí el monto» fuera de contexto.
//   - Una fila guardada con un monto que el parser de hoy no acepta (un
//     negativo de una cartola vieja) quedaba imposible de editar para siempre,
//     porque el editor la precarga tal cual y la reenvía sin tocarla.

const ETIQUETA_CAMPO: Record<string, string> = {
  reference: "referencia", description: "descripción", debit: "egreso", credit: "abono",
  rut: "RUT", bankName: "banco", accountNumber: "n° cuenta", accountType: "tipo de cuenta",
  email: "correo", categoryGeneral: "categoría", businessCenter: "centro de negocio", date: "fecha",
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
        const anterior = String(actual[campo as "debit" | "credit"]);
        const crudo = String(valor ?? "").trim();

        // Igual a lo guardado (en cualquier forma equivalente): no se toca ni
        // se valida. El editor reenvía SIEMPRE los dos montos, así que sin esto
        // una fila con un valor que el parser de hoy rechaza quedaría imposible
        // de editar hasta en su RUT.
        let sinCambio = false;
        try { sinCambio = dec(crudo).eq(dec(anterior)); } catch { sinCambio = crudo === anterior; }
        if (sinCambio) continue;

        // Vaciar el campo es la forma natural de poner el monto en cero.
        let nuevo: string;
        if (crudo === "") nuevo = "0.00";
        else {
          const leido = parsearMonto(crudo);
          // «No se puede» está en la lista blanca de failure(): así el motivo
          // llega textual en vez de convertirse en el error genérico.
          if (!leido.ok) throw new Error(`No se puede guardar el ${ETIQUETA_CAMPO[campo]}: ${leido.motivo}`);
          nuevo = leido.valor;
        }

        if (!dec(nuevo).eq(dec(anterior))) {
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
      select: {
        id: true, companyId: true, name: true, manual: true,
        movements: { select: { debit: true, credit: true } },
      },
    });
    if (!sheet) throw new Error("Planilla no encontrada");
    const user = await requireUser();
    if (!puede(user, ROLES_EDICION) || !alcanzaEmpresa(user, sheet.companyId)) {
      throw new Error("Tu rol no permite eliminar planillas de esta empresa");
    }
    // Una cartola se vuelve a subir; lo cargado a mano no está en ningún lado.
    if (sheet.manual) {
      throw new Error(
        "No se puede eliminar la planilla de cargas manuales: es lo único que no se puede volver a importar. Editá o corregí los movimientos uno por uno.",
      );
    }

    const total = sheet.movements.reduce((a, m) => a.plus(montoDe(m)), dec(0));

    await prisma.$transaction(async (tx) => {
      await registrarBitacora(tx, {
        companyId: sheet.companyId,
        actorUserId: user.id,
        action: "PLANILLA_ELIMINADA",
        // Con cuántos movimientos y por cuánta plata: sin eso, la línea de
        // bitácora no alcanza para saber qué se perdió.
        detail: `${sheet.name} · ${sheet.movements.length} movimiento(s) por ${formatMoney(total, "CLP")}`,
      });
      await tx.bankSheet.delete({ where: { id: sheetId } });
    });

    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
