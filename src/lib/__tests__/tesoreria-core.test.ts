import { describe, it, expect } from "vitest";
import { esPlanillaRegistroOC, motivoNoLiberable } from "../tesoreria-core";

const cartola = { name: "CC Santander" };
const registro = { name: "Órdenes de compra RHO" };

describe("planillas de registro de OC vs cartolas", () => {
  it("reconoce el registro con y sin tilde, singular y plural", () => {
    expect(esPlanillaRegistroOC("Órdenes de compra RHO")).toBe(true);
    expect(esPlanillaRegistroOC("Orden de compra Panimávida")).toBe(true);
    expect(esPlanillaRegistroOC("ÓRDENES DE COMPRA")).toBe(true);
    expect(esPlanillaRegistroOC("Ordenes de compra AFIS")).toBe(true); // sin tilde
  });

  it("una cartola no es registro", () => {
    expect(esPlanillaRegistroOC("CC Santander")).toBe(false);
    expect(esPlanillaRegistroOC("CC BICE")).toBe(false);
  });
});

// Regresiones de la revisión adversarial: ambas cadenas terminaban en una
// orden de transferencia real hacia el banco.
describe("qué no se puede liberar a un lote de transferencias", () => {
  it("un pago normal de cartola SÍ se libera", () => {
    expect(
      motivoNoLiberable({ debit: "500000", credit: "0", reference: "OC0039", sheet: cartola }),
    ).toBeNull();
  });

  it("un ABONO recibido NO (mandaría afuera la plata que nos pagaron)", () => {
    const motivo = motivoNoLiberable({
      debit: "0",
      credit: "500000",
      reference: "Depósito cliente",
      sheet: cartola,
    });
    expect(motivo).toContain("abono recibido");
  });

  it("una fila del REGISTRO de OC NO (pagaría el saldo entero de la orden)", () => {
    const motivo = motivoNoLiberable({
      debit: "21000000",
      credit: "0",
      reference: "OC0017",
      sheet: registro,
    });
    expect(motivo).toContain("registro de órdenes de compra");
  });

  it("una fila sin monto tampoco", () => {
    expect(
      motivoNoLiberable({ debit: "0", credit: "0", reference: "vacía", sheet: cartola }),
    ).toContain("no tiene monto");
  });

  it("el motivo nombra la referencia para que se sepa cuál sacar", () => {
    expect(
      motivoNoLiberable({ debit: "0", credit: "100", reference: "Reversa BICE", sheet: cartola }),
    ).toContain("Reversa BICE");
  });
});
