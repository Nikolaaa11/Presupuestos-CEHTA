"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ensureBudget, monthsPatchSchema, requireEditableBudget, salesLineInputSchema } from "@/lib/budget";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safeMessages = [
    "Solo la gerencia", "Este presupuesto", "Presupuesto no encontrado", "Línea de venta no encontrada",
    "La iniciativa no pertenece", "Una o más líneas",
  ];
  if (error instanceof Error && safeMessages.some((message) => error.message.startsWith(message))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible guardar los cambios" };
}

export async function startBudget(): Promise<Result> {
  try {
    await ensureBudget();
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addSalesLine(budgetId: string): Promise<Result> {
  try {
    await requireEditableBudget(budgetId);
    const last = await prisma.salesLine.aggregate({ where: { budgetId }, _max: { sortOrder: true } });
    await prisma.salesLine.create({
      data: {
        budgetId,
        client: "Nuevo cliente",
        saleType: "PROYECCION_PUBLICO",
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateSalesLineMeta(lineId: string, data: unknown): Promise<Result> {
  try {
    const line = await prisma.salesLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de venta no encontrada");
    await requireEditableBudget(line.budgetId);
    const parsed = salesLineInputSchema.partial().parse(data);
    if (parsed.capexItemId) {
      const capex = await prisma.capexItem.findFirst({
        where: { id: parsed.capexItemId, budgetId: line.budgetId },
        select: { id: true },
      });
      if (!capex) throw new Error("La iniciativa no pertenece a este presupuesto");
    }
    await prisma.salesLine.update({ where: { id: lineId }, data: parsed });
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateSalesLineMonths(lineId: string, patch: unknown): Promise<Result> {
  try {
    const line = await prisma.salesLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de venta no encontrada");
    await requireEditableBudget(line.budgetId);
    const parsed = monthsPatchSchema.parse(patch);
    await prisma.salesLine.update({ where: { id: lineId }, data: parsed });
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSalesLine(lineId: string): Promise<Result> {
  try {
    const line = await prisma.salesLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de venta no encontrada");
    await requireEditableBudget(line.budgetId);
    await prisma.salesLine.delete({ where: { id: lineId } });
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function bulkUpdateSalesMonths(
  budgetId: string,
  updates: { lineId: string; patch: unknown }[],
): Promise<Result> {
  try {
    await requireEditableBudget(budgetId);
    const parsed = updates.map(({ lineId, patch }) => ({ lineId, patch: monthsPatchSchema.parse(patch) }));
    const count = await prisma.salesLine.count({
      where: { budgetId, id: { in: parsed.map((update) => update.lineId) } },
    });
    if (count !== new Set(parsed.map((update) => update.lineId)).size) {
      throw new Error("Una o más líneas no pertenecen a este presupuesto");
    }
    await prisma.$transaction(
      parsed.map((update) => prisma.salesLine.update({ where: { id: update.lineId }, data: update.patch })),
    );
    revalidatePath("/ventas");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
