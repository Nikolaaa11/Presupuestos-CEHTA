"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";

type Result = { ok: true } | { ok: false; error: string };

function failure(error: unknown): Result {
  const safe = ["Solo", "Movimiento no encontrado", "Planilla no encontrada", "No tenés acceso"];
  if (error instanceof Error && safe.some((m) => error.message.startsWith(m))) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "No fue posible completar la operación" };
}

/**
 * El usuario puede OPERAR sobre la empresa: admin → todas; gerente → la suya.
 * El chequeo de rol es explícito (allowlist): los roles de solo lectura
 * previstos para fase 2 (FUND_ANALYST, VIEWER) no deben poder liberar pagos ni
 * borrar planillas por el solo hecho de tener companyId.
 */
const ROLES_QUE_OPERAN = ["FUND_ADMIN", "COMPANY_MANAGER"] as const;

async function requireCompanyAccess(companyId: string) {
  const user = await requireUser();
  if (!(ROLES_QUE_OPERAN as readonly string[]).includes(user.role)) {
    throw new Error("Solo la gerencia o el fondo pueden operar sobre los pagos");
  }
  if (user.role !== "FUND_ADMIN" && user.companyId !== companyId) {
    throw new Error("No tenés acceso a esta empresa");
  }
  return user;
}

/**
 * Botón Liberar / Deshacer. Alta frecuencia → SIN revalidatePath (la UI es
 * optimista y revierte si falla, misma política que las grillas). La
 * autorización vive acá: cargar movimiento → empresa de la planilla → guard.
 */
export async function setMovementReleased(movementId: string, released: boolean): Promise<Result> {
  try {
    const movement = await prisma.bankMovement.findUnique({
      where: { id: movementId },
      select: { id: true, sheet: { select: { companyId: true } } },
    });
    // Mismo mensaje para "no existe" y "no es tuyo": no revela qué IDs existen.
    if (!movement) throw new Error("Movimiento no encontrado");
    const user = await requireCompanyAccess(movement.sheet.companyId);

    await prisma.bankMovement.update({
      where: { id: movementId },
      data: released
        ? { released: true, releasedAt: new Date(), releasedById: user.id }
        : { released: false, releasedAt: null, releasedById: null },
    });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Elimina una planilla completa con sus movimientos (estructural → revalida). */
export async function deleteSheet(sheetId: string): Promise<Result> {
  try {
    const sheet = await prisma.bankSheet.findUnique({
      where: { id: sheetId },
      select: { id: true, companyId: true },
    });
    if (!sheet) throw new Error("Planilla no encontrada");
    await requireCompanyAccess(sheet.companyId);

    await prisma.bankSheet.delete({ where: { id: sheetId } });
    revalidatePath("/bancos");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
