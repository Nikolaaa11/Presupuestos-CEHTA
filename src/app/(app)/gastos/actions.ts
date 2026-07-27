"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { ensureBudget, expenseLineInputSchema, monthsPatchSchema, requireEditableBudget } from "@/lib/budget";
import { prisma } from "@/lib/prisma";

type Result = { ok: true } | { ok: false; error: string };

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safeMessages = [
    "Solo la gerencia", "Este presupuesto", "Presupuesto no encontrado", "Línea de gasto no encontrada",
    "La iniciativa no pertenece", "La categoría", "No hay categorías", "Una o más líneas",
  ];
  if (error instanceof Error && safeMessages.some((message) => error.message.startsWith(message))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible guardar los cambios" };
}

export async function startBudget(): Promise<Result> {
  try {
    await ensureBudget();
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addExpenseLine(budgetId: string): Promise<Result> {
  try {
    await requireEditableBudget(budgetId);
    const [category, last] = await Promise.all([
      prisma.expenseCategory.findFirst({ orderBy: { sortOrder: "asc" }, select: { id: true } }),
      prisma.expenseLine.aggregate({ where: { budgetId }, _max: { sortOrder: true } }),
    ]);
    if (!category) throw new Error("No hay categorías de gasto configuradas");
    await prisma.expenseLine.create({
      data: {
        budgetId,
        categoryId: category.id,
        item: "Nuevo ítem",
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateExpenseLineMeta(lineId: string, data: unknown): Promise<Result> {
  try {
    const line = await prisma.expenseLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de gasto no encontrada");
    await requireEditableBudget(line.budgetId);
    const parsed = expenseLineInputSchema.partial().parse(data);
    if (parsed.categoryId) {
      const category = await prisma.expenseCategory.findUnique({ where: { id: parsed.categoryId }, select: { id: true } });
      if (!category) throw new Error("La categoría seleccionada no existe");
    }
    if (parsed.capexItemId) {
      const capex = await prisma.capexItem.findFirst({
        where: { id: parsed.capexItemId, budgetId: line.budgetId },
        select: { id: true },
      });
      if (!capex) throw new Error("La iniciativa no pertenece a este presupuesto");
    }
    await prisma.expenseLine.update({ where: { id: lineId }, data: parsed });
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function updateExpenseLineMonths(lineId: string, patch: unknown): Promise<Result> {
  try {
    const line = await prisma.expenseLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de gasto no encontrada");
    await requireEditableBudget(line.budgetId);
    const parsed = monthsPatchSchema.parse(patch);
    await prisma.expenseLine.update({ where: { id: lineId }, data: parsed });
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteExpenseLine(lineId: string): Promise<Result> {
  try {
    const line = await prisma.expenseLine.findUnique({ where: { id: lineId }, select: { budgetId: true } });
    if (!line) throw new Error("Línea de gasto no encontrada");
    await requireEditableBudget(line.budgetId);
    await prisma.expenseLine.delete({ where: { id: lineId } });
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function bulkUpdateExpenseMonths(
  budgetId: string,
  updates: { lineId: string; patch: unknown }[],
): Promise<Result> {
  try {
    await requireEditableBudget(budgetId);
    const parsed = updates.map(({ lineId, patch }) => ({ lineId, patch: monthsPatchSchema.parse(patch) }));
    const count = await prisma.expenseLine.count({
      where: { budgetId, id: { in: parsed.map((update) => update.lineId) } },
    });
    if (count !== new Set(parsed.map((update) => update.lineId)).size) {
      throw new Error("Una o más líneas no pertenecen a este presupuesto");
    }
    await prisma.$transaction(
      parsed.map((update) => prisma.expenseLine.update({ where: { id: update.lineId }, data: update.patch })),
    );
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
