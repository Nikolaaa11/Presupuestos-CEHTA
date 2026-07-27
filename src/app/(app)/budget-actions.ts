"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { MONTH_KEYS } from "@/lib/money";

/**
 * Ciclo de vida del presupuesto (F4):
 *   BORRADOR → ENVIADO → (OBSERVADO → BORRADOR editable)* → APROBADO
 * El presupuesto APROBADO es un snapshot inmutable: reabrirlo crea la
 * versión siguiente (v+1) copiando todas las líneas; la versión aprobada
 * queda intacta para auditoría. Todo cambio de estado deja ApprovalEvent.
 */

type Result = { ok: true } | { ok: false; error: string };

const commentSchema = z.string().trim().max(1000);
const requiredCommentSchema = z
  .string()
  .trim()
  .min(5, "La observación debe explicar qué corregir (mínimo 5 caracteres)")
  .max(1000);

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safe = ["Solo", "El presupuesto", "Presupuesto no encontrado", "No se puede", "Para enviar"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible completar la operación" };
}

function revalidateAll() {
  for (const p of ["/", "/ventas", "/gastos", "/capex", "/consolidado"]) revalidatePath(p);
}

/** El gerente envía su presupuesto al fondo. */
export async function submitBudget(budgetId: string, comment?: string): Promise<Result> {
  try {
    const user = await requireUser();
    const parsedComment = commentSchema.parse(comment ?? "");

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      include: { _count: { select: { salesLines: true, expenseLines: true } } },
    });
    if (!budget) throw new Error("Presupuesto no encontrado");
    if (user.role !== "COMPANY_MANAGER" || user.companyId !== budget.companyId) {
      throw new Error("Solo la gerencia de la empresa puede enviar su presupuesto");
    }
    if (budget.status !== "BORRADOR" && budget.status !== "OBSERVADO") {
      throw new Error(`El presupuesto ya está ${budget.status.toLocaleLowerCase("es-CL")}`);
    }
    if (budget._count.salesLines === 0 && budget._count.expenseLines === 0) {
      throw new Error("Para enviar, el presupuesto necesita al menos una línea de ventas o gastos");
    }

    await prisma.$transaction([
      prisma.budget.update({
        where: { id: budgetId },
        data: { status: "ENVIADO", submittedAt: new Date() },
      }),
      prisma.approvalEvent.create({
        data: {
          budgetId,
          actorUserId: user.id,
          action: "ENVIADO",
          comment: parsedComment || null,
        },
      }),
    ]);

    revalidateAll();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** El fondo aprueba u observa un presupuesto ENVIADO. */
export async function reviewBudget(
  budgetId: string,
  decision: "APROBAR" | "OBSERVAR",
  comment: string,
): Promise<Result> {
  try {
    const user = await requireUser();
    if (user.role !== "FUND_ADMIN") throw new Error("Solo el fondo puede revisar presupuestos");
    if (decision !== "APROBAR" && decision !== "OBSERVAR") throw new Error("Decisión inválida");

    const parsedComment =
      decision === "OBSERVAR" ? requiredCommentSchema.parse(comment) : commentSchema.parse(comment ?? "");

    const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
    if (!budget) throw new Error("Presupuesto no encontrado");
    if (budget.status !== "ENVIADO") {
      throw new Error("Solo se puede revisar un presupuesto en estado enviado");
    }

    if (decision === "APROBAR") {
      await prisma.$transaction([
        prisma.budget.update({
          where: { id: budgetId },
          data: { status: "APROBADO", approvedAt: new Date() },
        }),
        prisma.capexItem.updateMany({
          where: { budgetId, approvalStatus: { in: ["BORRADOR", "ENVIADO"] } },
          data: { approvalStatus: "APROBADO" },
        }),
        prisma.approvalEvent.create({
          data: { budgetId, actorUserId: user.id, action: "APROBADO", comment: parsedComment || null },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.budget.update({ where: { id: budgetId }, data: { status: "OBSERVADO" } }),
        prisma.approvalEvent.create({
          data: { budgetId, actorUserId: user.id, action: "OBSERVADO", comment: parsedComment },
        }),
      ]);
    }

    revalidateAll();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * El fondo reabre un presupuesto APROBADO: crea la versión v+1 en BORRADOR
 * copiando ventas, gastos y capex (con vínculos re-mapeados). La versión
 * aprobada queda inmutable como snapshot de auditoría.
 */
export async function reopenBudget(budgetId: string, comment: string): Promise<Result> {
  try {
    const user = await requireUser();
    if (user.role !== "FUND_ADMIN") throw new Error("Solo el fondo puede reabrir un presupuesto aprobado");
    const parsedComment = requiredCommentSchema.parse(comment);

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
      include: {
        salesLines: { orderBy: { sortOrder: "asc" } },
        expenseLines: { orderBy: { sortOrder: "asc" } },
        capexItems: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!budget) throw new Error("Presupuesto no encontrado");
    if (budget.status !== "APROBADO") throw new Error("Solo se puede reabrir un presupuesto aprobado");

    const monthData = (line: Record<string, unknown>) =>
      Object.fromEntries(MONTH_KEYS.map((k) => [k, String(line[k as keyof typeof line])]));

    await prisma.$transaction(async (tx) => {
      const next = await tx.budget.create({
        data: {
          companyId: budget.companyId,
          year: budget.year,
          version: budget.version + 1,
          status: "BORRADOR",
          currency: budget.currency,
        },
      });

      // capex primero, para re-mapear los vínculos de las líneas
      const capexIdMap = new Map<string, string>();
      for (const item of budget.capexItems) {
        const created = await tx.capexItem.create({
          data: {
            budgetId: next.id,
            description: item.description,
            purpose: item.purpose,
            amount: item.amount.toString(),
            currency: item.currency,
            monthNeeded: item.monthNeeded,
            financingMonths: item.financingMonths,
            financingSource: item.financingSource,
            isInitiative: item.isInitiative,
            initiativeName: item.initiativeName,
            approvalLevel: item.approvalLevel,
            approvalStatus: "BORRADOR",
            sortOrder: item.sortOrder,
          },
        });
        capexIdMap.set(item.id, created.id);
      }

      if (budget.salesLines.length > 0) {
        await tx.salesLine.createMany({
          data: budget.salesLines.map((l) => ({
            budgetId: next.id,
            client: l.client,
            saleType: l.saleType,
            channel: l.channel,
            capexItemId: l.capexItemId ? (capexIdMap.get(l.capexItemId) ?? null) : null,
            sortOrder: l.sortOrder,
            ...monthData(l),
          })),
        });
      }

      if (budget.expenseLines.length > 0) {
        await tx.expenseLine.createMany({
          data: budget.expenseLines.map((l) => ({
            budgetId: next.id,
            categoryId: l.categoryId,
            item: l.item,
            capexItemId: l.capexItemId ? (capexIdMap.get(l.capexItemId) ?? null) : null,
            sortOrder: l.sortOrder,
            ...monthData(l),
          })),
        });
      }

      await tx.approvalEvent.create({
        data: {
          budgetId: next.id,
          actorUserId: user.id,
          action: "REABIERTO",
          comment: `Reabre v${budget.version} aprobada → crea v${next.version}. ${parsedComment}`,
        },
      });
    });

    revalidateAll();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
