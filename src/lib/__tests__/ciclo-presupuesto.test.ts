import { describe, it, expect } from "vitest";
import {
  isEditableStatus,
  canEditBudget,
  puedeRevisar,
  puedeAprobar,
  EDITABLE_STATUSES,
} from "../budget-policy";

/**
 * Ciclo del presupuesto con las mismas manos que el circuito de pagos:
 *   BORRADOR ─envía→ ENVIADO ─revisa→ REVISADO ─aprueba→ APROBADO
 *              (encargado)   (Victoria)         (Guido)
 */

const encargado = { role: "COMPANY_MANAGER", companyId: "empresa-1" };
const otroEncargado = { role: "COMPANY_MANAGER", companyId: "empresa-2" };
const victoria = { role: "ADMINISTRADORA", companyId: null };
const guido = { role: "DUENO", companyId: null };
const admin = { role: "FUND_ADMIN", companyId: null };

describe("qué estados puede editar el encargado", () => {
  it("edita mientras está en borrador o cuando se lo observaron", () => {
    expect(isEditableStatus("BORRADOR")).toBe(true);
    expect(isEditableStatus("OBSERVADO")).toBe(true);
  });

  it("NO edita una vez que lo envió ni después de revisado o aprobado", () => {
    for (const estado of ["ENVIADO", "REVISADO", "APROBADO", "CERRADO"]) {
      expect(isEditableStatus(estado), `${estado} no debe ser editable`).toBe(false);
    }
  });

  it("los estados editables son exactamente dos", () => {
    expect([...EDITABLE_STATUSES]).toEqual(["BORRADOR", "OBSERVADO"]);
  });
});

describe("quién puede editar el presupuesto de una empresa", () => {
  const presupuestoBorrador = { companyId: "empresa-1", status: "BORRADOR" };

  it("el encargado de la empresa sí", () => {
    expect(canEditBudget(encargado, presupuestoBorrador)).toBe(true);
  });

  it("el encargado de OTRA empresa no", () => {
    expect(canEditBudget(otroEncargado, presupuestoBorrador)).toBe(false);
  });

  it("Victoria y Guido no editan las líneas: revisan y aprueban", () => {
    expect(canEditBudget(victoria, presupuestoBorrador)).toBe(false);
    expect(canEditBudget(guido, presupuestoBorrador)).toBe(false);
    expect(canEditBudget(admin, presupuestoBorrador)).toBe(false);
  });

  it("nadie edita un presupuesto ya enviado o aprobado", () => {
    for (const status of ["ENVIADO", "REVISADO", "APROBADO"]) {
      expect(canEditBudget(encargado, { companyId: "empresa-1", status })).toBe(false);
    }
  });
});

describe("facultades del ciclo (separación de funciones)", () => {
  it("Victoria revisa pero NO aprueba", () => {
    expect(puedeRevisar(victoria.role)).toBe(true);
    expect(puedeAprobar(victoria.role)).toBe(false);
  });

  it("el dueño NO revisa (si revisara firmaría los dos pasos), pero aprueba", () => {
    expect(puedeRevisar(guido.role)).toBe(false);
    expect(puedeAprobar(guido.role)).toBe(true);
  });

  it("el encargado no revisa ni aprueba lo suyo", () => {
    expect(puedeRevisar(encargado.role)).toBe(false);
    expect(puedeAprobar(encargado.role)).toBe(false);
  });

  it("ningún rol operativo concentra las dos firmas", () => {
    // FUND_ADMIN queda fuera a propósito: es el superusuario de la plataforma y
    // existe para destrabar el circuito. Para él la garantía la da el chequeo de
    // cuatro ojos del server action, no la lista de roles.
    for (const rol of ["ADMINISTRADORA", "DUENO", "COMPANY_MANAGER", "FUND_ANALYST", "VIEWER"]) {
      expect(
        puedeRevisar(rol) && puedeAprobar(rol),
        `${rol} no debería poder revisar Y aprobar`,
      ).toBe(false);
    }
  });
});
