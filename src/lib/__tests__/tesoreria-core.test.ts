import { describe, it, expect } from "vitest";
import { esPlanillaRegistroOC, motivoNoLiberable, parsearMonto } from "../tesoreria-core";

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

  // La planilla de cargas manuales NO puede leerse como registro de órdenes:
  // sus filas serían "el saldo de la orden" y dejarían de ser liberables.
  it("la planilla de cargas manuales es una cartola, no un registro", () => {
    expect(esPlanillaRegistroOC("Cargas manuales")).toBe(false);
  });
});

describe("parsearMonto — nunca adivina, o entiende o dice por qué no", () => {
  const ok = (entrada: string, esperado: string) => {
    const r = parsearMonto(entrada);
    expect(r, `${entrada} debería leerse`).toMatchObject({ ok: true });
    if (r.ok) expect(r.valor, `${entrada}`).toBe(esperado);
  };
  const falla = (entrada: string) => {
    const r = parsearMonto(entrada);
    expect(r.ok, `${entrada} NO debería leerse`).toBe(false);
  };

  it("lee como se escribe en Chile", () => {
    ok("1.500.000", "1500000.00");
    ok("1500000,50", "1500000.50");
    ok("$ 1.234.567", "1234567.00");
    ok("1.500", "1500.00");
    ok("250000000", "250000000.00");
    ok("0", "0.00");
  });

  // Regresión del parser viejo, verificada ejecutándolo: cada una de estas
  // entradas guardaba un monto EQUIVOCADO sin avisar.
  it("lee bien lo pegado de un Excel en inglés (antes dividía por mil)", () => {
    ok("1,234.56", "1234.56"); // normalizarMonto daba 1.23
    ok("12,345,678.90", "12345678.90"); // normalizarMonto daba 0
  });

  it("rechaza los tres decimales en vez de multiplicar por mil", () => {
    falla("250000000.555"); // normalizarMonto daba 250000000555.00
  });

  it("rechaza el signo negativo en vez de borrarlo", () => {
    falla("-350.000"); // normalizarMonto daba 350000.00
    falla("(1.500)"); // normalizarMonto daba 0
  });

  it("rechaza lo que no es un número en vez de devolver cero", () => {
    for (const basura of ["abc", "5%", "1..5", "Infinity", "", "   ", "1,2,3"]) {
      falla(basura);
    }
  });

  it("rechaza notación científica y hexadecimal", () => {
    falla("1e9"); // normalizarMonto daba 1000000000.00
    falla("0x10"); // normalizarMonto daba 16.00
    falla("1e21"); // normalizarMonto daba "1e+21", que Prisma rechaza en crudo
  });

  it("rechaza lo que no cabe en Decimal(18,2)", () => {
    falla("12345678901234567");
  });

  // La revisión adversarial encontró que «$1.500.000.-» —como se escribe un
  // monto en una factura chilena— se rechazaba diciendo «elegí Abono recibido»,
  // empujando al usuario al tipo de movimiento equivocado.
  it("entiende el guion de cierre de las facturas chilenas", () => {
    ok("$1.500.000.-", "1500000.00");
    ok("1.500.-", "1500.00");
    ok("2.500,-", "2500.00"); // la variante con coma, igual de común
  });

  it("pero un menos adelante sigue siendo un menos", () => {
    falla("-350.000");
    falla("-1.500.000.-");
  });

  it("el cero se entiende — quien lo rechace debe hacerlo con su propio mensaje", () => {
    const r = parsearMonto("0");
    expect(r.ok).toBe(true);
    // Distinguir "no entendí" de "entendí cero" es el punto: son dos errores
    // distintos para el usuario.
    expect(parsearMonto("").ok).toBe(false);
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
