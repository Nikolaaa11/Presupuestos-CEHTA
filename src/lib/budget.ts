import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, type SessionUser } from "@/lib/authz";

/**
 * Reglas de negocio del ciclo presupuestario — fuente de verdad.
 * BORRADOR y OBSERVADO son editables por el gerente de la empresa.
 * ENVIADO / APROBADO / CERRADO son de solo lectura (la API lo garantiza, no la UI).
 */

export const BUDGET_YEAR = 2027; // selector multi-año: F5

export const EDITABLE_STATUSES = ["BORRADOR", "OBSERVADO"] as const;

export function isEditableStatus(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

/** El gerente edita su empresa en estados editables; el admin nunca edita líneas. */
export function canEditBudget(
  user: Pick<SessionUser, "role" | "companyId">,
  budget: { companyId: string; status: string },
): boolean {
  return (
    user.role === "COMPANY_MANAGER" &&
    user.companyId === budget.companyId &&
    isEditableStatus(budget.status)
  );
}

/**
 * Empresa efectiva de la vista:
 *  - COMPANY_MANAGER → siempre la propia (ignora ?empresa=)
 *  - FUND_ADMIN → la del query param ?empresa=CODE (solo lectura)
 */
export async function resolveViewCompany(requestedCode?: string | null) {
  const user = await requireUser();

  if (user.role === "COMPANY_MANAGER") {
    if (!user.companyId) throw new Error("Usuario sin empresa asignada");
    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    if (!company) throw new Error("Empresa no encontrada");
    return { user, company, readOnly: false as const };
  }

  // FUND_ADMIN
  const code = requestedCode?.toUpperCase();
  const company = code
    ? await prisma.company.findUnique({ where: { code } })
    : await prisma.company.findFirst({ orderBy: { code: "asc" } });
  if (!company) throw new Error("Empresa no encontrada");
  return { user, company, readOnly: true as const };
}

/** Presupuesto vigente (mayor versión) de la empresa para el año. */
export async function getCurrentBudget(companyId: string, year = BUDGET_YEAR) {
  return prisma.budget.findFirst({
    where: { companyId, year },
    orderBy: { version: "desc" },
    include: {
      salesLines: { orderBy: { sortOrder: "asc" }, include: { capexItem: { select: { id: true, initiativeName: true, description: true } } } },
      expenseLines: { orderBy: { sortOrder: "asc" }, include: { category: true, capexItem: { select: { id: true, initiativeName: true, description: true } } } },
      capexItems: { orderBy: { sortOrder: "asc" } },
    },
  });
}

/**
 * Garantiza que exista un presupuesto BORRADOR para la empresa del gerente.
 * Solo el COMPANY_MANAGER de la empresa puede crearlo.
 */
export async function ensureBudget(year = BUDGET_YEAR) {
  const user = await requireUser();
  if (user.role !== "COMPANY_MANAGER" || !user.companyId) {
    throw new Error("Solo la gerencia de la empresa puede crear su presupuesto");
  }
  const existing = await prisma.budget.findFirst({
    where: { companyId: user.companyId, year },
    orderBy: { version: "desc" },
  });
  if (existing) return existing;
  return prisma.budget.create({
    data: { companyId: user.companyId, year, version: 1, status: "BORRADOR", currency: "CLP" },
  });
}

/**
 * Carga un presupuesto y valida que el usuario actual pueda EDITARLO.
 * Úsese al inicio de todo server action de escritura sobre líneas.
 */
export async function requireEditableBudget(budgetId: string) {
  const user = await requireUser();
  const budget = await prisma.budget.findUnique({
    where: { id: budgetId },
    select: { id: true, companyId: true, status: true, year: true },
  });
  if (!budget) throw new Error("Presupuesto no encontrado");
  if (!canEditBudget(user, budget)) {
    throw new Error("Este presupuesto no es editable con tu rol o en su estado actual");
  }
  return { user, budget };
}

// ─────────────────────────── Validación de entradas ───────────────────────────

/** Monto de celda: 0 a 999.999.999.999, hasta 2 decimales, como string. */
export const cellAmountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/\s/g, ""))
  .refine((v) => v === "" || /^-?\d{1,12}([.,]\d{1,2})?$/.test(v), {
    message: "Monto inválido",
  })
  .transform((v) => (v === "" ? "0" : v.replace(",", ".")))
  .refine((v) => Number(v) >= 0, { message: "Los montos no pueden ser negativos" });

export const monthsPatchSchema = z
  .object({
    m01: cellAmountSchema, m02: cellAmountSchema, m03: cellAmountSchema, m04: cellAmountSchema,
    m05: cellAmountSchema, m06: cellAmountSchema, m07: cellAmountSchema, m08: cellAmountSchema,
    m09: cellAmountSchema, m10: cellAmountSchema, m11: cellAmountSchema, m12: cellAmountSchema,
  })
  .partial();

export const salesLineInputSchema = z.object({
  client: z.string().trim().min(1, "El cliente es obligatorio").max(200),
  saleType: z.enum(["CONTRATO", "PROYECCION_PUBLICO", "RECURRENTE"]),
  channel: z.string().trim().max(200).optional().nullable(),
  capexItemId: z.string().cuid().optional().nullable(),
});

export const expenseLineInputSchema = z.object({
  item: z.string().trim().min(1, "El ítem es obligatorio").max(200),
  categoryId: z.string().cuid(),
  capexItemId: z.string().cuid().optional().nullable(),
});
