"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";

type Result = { ok: true } | { ok: false; error: string };

const rateSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", "."))
  .refine((v) => /^\d{1,10}(\.\d{1,2})?$/.test(v), { message: "Valor inválido" })
  .refine((v) => Number(v) > 0, { message: "El tipo de cambio debe ser mayor que 0" });

const categoryNameSchema = z.string().trim().min(2, "Nombre muy corto").max(80);

function failure(error: unknown): Result {
  if (error instanceof ZodError) return { ok: false, error: error.issues[0]?.message ?? "Datos inválidos" };
  const safe = ["Solo", "Ya existe", "Categoría no encontrada", "Empresa no encontrada"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible guardar" };
}

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "FUND_ADMIN") throw new Error("Solo el fondo puede modificar la configuración");
  return user;
}

/** Actualiza (o crea) los tipos de cambio del año. Afecta conversiones y niveles N1–N6 futuros. */
export async function saveFxRate(year: number, ufToClp: unknown, usdToClp: unknown): Promise<Result> {
  try {
    const user = await requireAdmin();
    if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new Error("Año inválido");
    const uf = rateSchema.parse(ufToClp);
    const usd = rateSchema.parse(usdToClp);

    await prisma.fxRate.upsert({
      where: { year },
      update: { ufToClp: uf, usdToClp: usd, updatedById: user.id },
      create: { year, ufToClp: uf, usdToClp: usd, updatedById: user.id },
    });

    for (const p of ["/", "/capex", "/consolidado", "/configuracion"]) revalidatePath(p);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addExpenseCategory(name: unknown): Promise<Result> {
  try {
    await requireAdmin();
    const parsed = categoryNameSchema.parse(name);
    const exists = await prisma.expenseCategory.findUnique({ where: { name: parsed } });
    if (exists) throw new Error("Ya existe una categoría con ese nombre");
    const last = await prisma.expenseCategory.aggregate({ _max: { sortOrder: true } });
    await prisma.expenseCategory.create({
      data: { name: parsed, isSystem: false, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    revalidatePath("/configuracion");
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function renameExpenseCategory(id: string, name: unknown): Promise<Result> {
  try {
    await requireAdmin();
    const parsed = categoryNameSchema.parse(name);
    const category = await prisma.expenseCategory.findUnique({ where: { id } });
    if (!category) throw new Error("Categoría no encontrada");
    const clash = await prisma.expenseCategory.findUnique({ where: { name: parsed } });
    if (clash && clash.id !== id) throw new Error("Ya existe una categoría con ese nombre");
    await prisma.expenseCategory.update({ where: { id }, data: { name: parsed } });
    revalidatePath("/configuracion");
    revalidatePath("/gastos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Cuenta corriente Santander desde la que paga cada empresa — la columna
 * "Cuenta origen" de la nómina de transferencias masivas. Vacía = la celda A
 * de la nómina queda en blanco y el Resumen lo advierte.
 */
export async function saveCuentaOrigen(companyId: string, cuenta: unknown): Promise<Result> {
  try {
    await requireAdmin();
    const limpia = String(cuenta ?? "").replace(/[^\dA-Za-z]/g, "").slice(0, 30);
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new Error("Empresa no encontrada");
    await prisma.company.update({
      where: { id: companyId },
      data: { cuentaOrigen: limpia === "" ? null : limpia },
    });
    for (const p of ["/bancos", "/configuracion"]) revalidatePath(p);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
