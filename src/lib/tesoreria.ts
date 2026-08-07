import "server-only";
import { prisma } from "@/lib/prisma";
import { requireUser, type SessionUser } from "@/lib/authz";

export { esPlanillaRegistroOC, motivoNoLiberable } from "@/lib/tesoreria-core";

/**
 * Circuito de pagos del fondo (mandato del directorio 29-07-2026):
 *
 *   PENDIENTE ──libera──▶ LIBERADO ──comprobante──▶ EN_TRANSFERENCIA ──confirma──▶ TRANSFERIDO
 *      (—)                 (dueño)                  (administradora)                (dueño)
 *
 * Las tres etapas tienen dueño distinto a propósito: quien autoriza el pago no
 * es quien lo ejecuta. El FUND_ADMIN puede todo por ser administración de la
 * plataforma, pero queda igualmente registrado en la bitácora.
 */

/** Quién puede liberar pagos y confirmar que se transfirieron. */
export const ROLES_DUENO = ["DUENO", "FUND_ADMIN"] as const;
/** Quién puede subir el comprobante de la transferencia. */
export const ROLES_COMPROBANTE = ["ADMINISTRADORA", "DUENO", "FUND_ADMIN"] as const;
/** Quién puede editar los datos de un movimiento. */
export const ROLES_EDICION = ["ADMINISTRADORA", "DUENO", "FUND_ADMIN", "COMPANY_MANAGER"] as const;

export function puede(user: Pick<SessionUser, "role">, roles: readonly string[]): boolean {
  return roles.includes(user.role);
}

/** Acceso a la empresa: el fondo y el circuito ven todas; el gerente, la suya. */
export function alcanzaEmpresa(
  user: Pick<SessionUser, "role" | "companyId">,
  companyId: string,
): boolean {
  if (user.role === "COMPANY_MANAGER") return user.companyId === companyId;
  return ["FUND_ADMIN", "DUENO", "ADMINISTRADORA", "FUND_ANALYST", "VIEWER"].includes(user.role);
}

export async function requireAcceso(companyId: string, roles: readonly string[]) {
  const user = await requireUser();
  if (!puede(user, roles)) {
    throw new Error("Tu rol no permite esta acción en el circuito de pagos");
  }
  if (!alcanzaEmpresa(user, companyId)) {
    throw new Error("No tenés acceso a esta empresa");
  }
  return user;
}

/** Escribe una línea de bitácora. Nunca se actualiza ni se borra. */
export async function registrarBitacora(
  tx: Pick<typeof prisma, "bankEvent">,
  data: {
    companyId: string;
    actorUserId: string;
    action:
      | "LIBERADO"
      | "LIBERACION_DESHECHA"
      | "COMPROBANTE_SUBIDO"
      | "TRANSFERIDO"
      | "TRANSFERENCIA_REVERTIDA"
      | "MOVIMIENTO_EDITADO"
      | "PLANILLA_IMPORTADA"
      | "PLANILLA_ELIMINADA";
    movementId?: string | null;
    batchId?: string | null;
    detail?: string | null;
  },
) {
  await tx.bankEvent.create({ data });
}

/** Correlativo del próximo lote de la empresa (LOTE-001, LOTE-002…). */
export async function siguienteNumeroLote(companyId: string): Promise<number> {
  const ultimo = await prisma.transferBatch.aggregate({
    where: { companyId },
    _max: { number: true },
  });
  return (ultimo._max.number ?? 0) + 1;
}

export const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE: "Pendiente",
  LIBERADO: "Liberado",
  EN_TRANSFERENCIA: "En transferencia",
  TRANSFERIDO: "Transferido",
};

export const ETIQUETA_ACCION: Record<string, string> = {
  LIBERADO: "liberó el pago",
  LIBERACION_DESHECHA: "deshizo la liberación",
  COMPROBANTE_SUBIDO: "subió el comprobante de transferencia",
  TRANSFERIDO: "confirmó la transferencia",
  TRANSFERENCIA_REVERTIDA: "revirtió la transferencia",
  MOVIMIENTO_EDITADO: "editó el movimiento",
  PLANILLA_IMPORTADA: "importó una planilla",
  PLANILLA_ELIMINADA: "eliminó una planilla",
};

