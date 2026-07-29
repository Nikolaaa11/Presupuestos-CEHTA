/**
 * Reglas puras del ciclo presupuestario — sin Prisma ni `server-only`, para que
 * las importen tanto los server actions como los componentes cliente y los tests.
 *
 *   BORRADOR ─envía→ ENVIADO ─revisa→ REVISADO ─aprueba→ APROBADO
 *              (encargado)   (Victoria)         (Guido)
 *
 * Las mismas manos que el circuito de pagos: quien prepara no revisa, quien
 * revisa no aprueba. Si estas listas se duplican en la UI y en el server action,
 * terminan divergiendo — de ahí que vivan acá y en un solo lugar.
 */

/** Estados en los que el encargado de la empresa puede tocar las líneas. */
export const EDITABLE_STATUSES = ["BORRADOR", "OBSERVADO"] as const;

/**
 * Da el visto bueno (ENVIADO → REVISADO) y puede observar.
 * El dueño NO revisa: si revisara, firmaría los dos pasos y la aprobación
 * dejaría de tener dos manos. Si la administradora no está, el administrador
 * del fondo revisa como excepción.
 */
export const PUEDE_REVISAR = ["ADMINISTRADORA", "FUND_ADMIN"] as const;

/** Aprueba en firme (REVISADO → APROBADO) y puede reabrir una versión aprobada. */
export const PUEDE_APROBAR = ["DUENO", "FUND_ADMIN"] as const;

export function isEditableStatus(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status);
}

export function puedeRevisar(role: string): boolean {
  return (PUEDE_REVISAR as readonly string[]).includes(role);
}

export function puedeAprobar(role: string): boolean {
  return (PUEDE_APROBAR as readonly string[]).includes(role);
}

/** El encargado edita su empresa en estados editables; el fondo nunca edita líneas. */
export function canEditBudget(
  user: { role: string; companyId: string | null },
  budget: { companyId: string; status: string },
): boolean {
  return (
    user.role === "COMPANY_MANAGER" &&
    user.companyId === budget.companyId &&
    isEditableStatus(budget.status)
  );
}
