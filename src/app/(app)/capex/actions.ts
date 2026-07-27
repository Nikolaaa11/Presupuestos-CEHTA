"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireEditableBudget } from "@/lib/budget";
import { approvalLevelFor } from "@/lib/capex";
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
