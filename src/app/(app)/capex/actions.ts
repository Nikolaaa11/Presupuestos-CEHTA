"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { requireEditableBudget } from "@/lib/budget";
import { approvalLevelFor } from "@/lib/capex";
import { sumaPorcentajes } from "@/lib/avisos-core";
import { puede, alcanzaEmpresa, ROLES_EDICION } from "@/lib/tesoreria";
import type { CurrencyCode, Fx } from "@/lib/money";

type Result = { ok: true } | { ok: false; error: string };

const FX_FALLBACK: Fx = { ufToClp: "39200", usdToClp: "950" };

const capexInputSchema = z.object({
  description: z.string().trim().min(1, "La descripción es obligatoria").max(200),
  purpose: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
  amount: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/\s/g, ""))
    .transform((v) => {
      // normaliza formato es-CL: 1.234.567,89 → 1234567.89
      if (v.includes(",")) return v.replace(/\./g, "").replace(",", ".");
      const dots = v.match(/\./g)?.length ?? 0;
      if (dots > 1 || (dots === 1 && /^\d{1,3}\.\d{3}$/.test(v))) return v.replace(/\./g, "");
      return v;
    })
    .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), { message: "Monto inválido" })
    .refine((v) => Number(v) > 0, { message: "El monto debe ser mayor que 0" }),
  currency: z.enum(["CLP", "UF", "USD"]),
  monthNeeded: z.coerce.number().int().min(1, "Mes inválido").max(12, "Mes inválido"),
  financingMonths: z
    .union([z.coerce.number(), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (v === "" || v === null || v === undefined || Number.isNaN(v) ? null : v))
    .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 360), {
      message: "El plazo debe ser entre 1 y 360 meses",
    }),
  financingSource: z.enum(["CAJA_PROPIA", "BANCO", "FONDO", "LEASING", "MIXTO"]),
  isInitiative: z.coerce.boolean(),
  initiativeName: z.string().trim().max(120).optional().nullable().transform((v) => (v ? v : null)),
});

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safe = ["Solo la gerencia", "Este presupuesto", "Presupuesto no encontrado", "Ítem no encontrado"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible guardar los cambios" };
}

async function fxForYear(year: number): Promise<Fx> {
  const fx = await prisma.fxRate.findUnique({ where: { year } });
  return fx ? { ufToClp: fx.ufToClp.toString(), usdToClp: fx.usdToClp.toString() } : FX_FALLBACK;
}

export async function saveCapexItem(
  budgetId: string,
  itemId: string | null,
  data: unknown,
): Promise<Result> {
  try {
    const { budget } = await requireEditableBudget(budgetId);
    const parsed = capexInputSchema.parse(data);
    const fx = await fxForYear(budget.year);
    // El nivel N1–N6 SIEMPRE se recalcula server-side — la UI jamás lo decide.
    const approvalLevel = approvalLevelFor(parsed.amount, parsed.currency as CurrencyCode, fx);

    const payload = {
      description: parsed.description,
      purpose: parsed.purpose,
      amount: parsed.amount,
      currency: parsed.currency,
      monthNeeded: parsed.monthNeeded,
      financingMonths: parsed.financingMonths,
      financingSource: parsed.financingSource,
      isInitiative: parsed.isInitiative,
      initiativeName: parsed.isInitiative ? (parsed.initiativeName ?? parsed.description) : null,
      approvalLevel,
    };

    if (itemId) {
      const existing = await prisma.capexItem.findFirst({
        where: { id: itemId, budgetId },
        select: { id: true },
      });
      if (!existing) throw new Error("Ítem no encontrado");
      await prisma.capexItem.update({ where: { id: itemId }, data: payload });
    } else {
      const last = await prisma.capexItem.aggregate({ where: { budgetId }, _max: { sortOrder: true } });
      await prisma.capexItem.create({
        data: { ...payload, budgetId, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
    }

    revalidatePath("/capex");
    revalidatePath("/ventas");
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteCapexItem(itemId: string): Promise<Result> {
  try {
    const item = await prisma.capexItem.findUnique({ where: { id: itemId }, select: { budgetId: true } });
    if (!item) throw new Error("Ítem no encontrado");
    await requireEditableBudget(item.budgetId);
    // Las líneas vinculadas quedan sin iniciativa (onDelete: SetNull), no se borran.
    await prisma.capexItem.delete({ where: { id: itemId } });
    revalidatePath("/capex");
    revalidatePath("/ventas");
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

// ─────────────── Cronograma de pago por etapas (porcentajes) ───────────────
//
// Dos reglas de autorización distintas a propósito:
//  - EDITAR el cronograma (agregar/quitar etapas) es planificar → sigue la
//    editabilidad del presupuesto, como cualquier otra cifra.
//  - MARCAR PAGADA una etapa es operar → se permite también con el presupuesto
//    aprobado (los pagos ocurren después de aprobar), con alcance por empresa.

const etapaInputSchema = z.object({
  label: z.string().trim().min(1, "El nombre de la etapa es obligatorio").max(60),
  percent: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(",", "."))
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v), { message: "Porcentaje inválido" })
    .refine((v) => Number(v) > 0 && Number(v) <= 100, {
      message: "El porcentaje debe ser mayor que 0 y hasta 100",
    }),
  dueMonth: z.coerce.number().int().min(1, "Mes inválido").max(12, "Mes inválido"),
});

const failureEtapa = (error: unknown): Result => {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safe = ["Solo la gerencia", "Este presupuesto", "Ítem no encontrado", "Etapa no encontrada", "El cronograma", "Tu rol", "No tenés acceso"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible guardar el cronograma" };
};

export async function agregarEtapaPago(capexItemId: string, data: unknown): Promise<Result> {
  try {
    const item = await prisma.capexItem.findUnique({
      where: { id: capexItemId },
      select: { budgetId: true },
    });
    if (!item) throw new Error("Ítem no encontrado");
    await requireEditableBudget(item.budgetId);

    const parsed = etapaInputSchema.parse(data);

    // Validar-y-crear dentro de una transacción, con RE-chequeo después del
    // insert: dos submits concurrentes (doble pestaña) pasarían los dos un
    // chequeo previo con la misma foto y dejarían el cronograma en 120%.
    // El segundo en confirmar ve el insert del primero y aborta.
    await prisma.$transaction(async (tx) => {
      const last = await tx.capexPaymentStage.aggregate({
        where: { capexItemId },
        _max: { sortOrder: true },
      });
      await tx.capexPaymentStage.create({
        data: {
          capexItemId,
          label: parsed.label,
          percent: parsed.percent,
          dueMonth: parsed.dueMonth,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
      const etapas = await tx.capexPaymentStage.findMany({
        where: { capexItemId },
        select: { percent: true },
      });
      const suma = sumaPorcentajes(etapas.map((s) => s.percent));
      if (suma.gt(100)) {
        throw new Error(
          `El cronograma no puede superar el 100% — con esta etapa sumaría ${suma.toString()}%`,
        );
      }
    });

    revalidatePath("/capex");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failureEtapa(error);
  }
}

export async function eliminarEtapaPago(stageId: string): Promise<Result> {
  try {
    const stage = await prisma.capexPaymentStage.findUnique({
      where: { id: stageId },
      select: { paid: true, capexItem: { select: { budgetId: true } } },
    });
    if (!stage) throw new Error("Etapa no encontrada");
    // Una etapa pagada lleva el registro de quién pagó y cuándo: borrarla lo
    // destruiría sin traza. Primero se desmarca (queda en la mano de quien
    // puede marcar pagos), recién ahí se puede quitar del cronograma.
    if (stage.paid) throw new Error("No se puede quitar una etapa pagada: desmarcala primero");
    await requireEditableBudget(stage.capexItem.budgetId);
    await prisma.capexPaymentStage.delete({ where: { id: stageId } });
    revalidatePath("/capex");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failureEtapa(error);
  }
}

export async function marcarEtapaPagada(stageId: string, paid: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    const stage = await prisma.capexPaymentStage.findUnique({
      where: { id: stageId },
      select: { capexItem: { select: { budget: { select: { companyId: true } } } } },
    });
    if (!stage) throw new Error("Etapa no encontrada");

    if (!puede(user, ROLES_EDICION)) throw new Error("Tu rol no permite marcar pagos");
    if (!alcanzaEmpresa(user, stage.capexItem.budget.companyId)) {
      throw new Error("No tenés acceso a esta empresa");
    }

    await prisma.capexPaymentStage.update({
      where: { id: stageId },
      data: paid
        ? { paid: true, paidAt: new Date(), paidById: user.id }
        : { paid: false, paidAt: null, paidById: null },
    });

    revalidatePath("/capex");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return failureEtapa(error);
  }
}
