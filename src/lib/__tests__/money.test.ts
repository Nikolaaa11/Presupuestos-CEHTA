import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { dec, lineTotal, monthlyTotals, monthlyFlow, toClp, toUF, formatMoney, MONTH_KEYS } from "../money";
import { approvalLevelForUF, approvalLevelFor, overrunRule, estimatedInstallment } from "../capex";

const FX = { ufToClp: "39200.00", usdToClp: "950.00" };

describe("dinero — precisión Decimal", () => {
  it("suma 12 meses sin error de float (0.1 × 12 = 1.2 exacto)", () => {
    const line = Object.fromEntries(MONTH_KEYS.map((k) => [k, "0.10"]));
    expect(lineTotal(line).toString()).toBe("1.2"); // con float: 1.2000000000000002
  });

  it("totales por mes suman columna a columna", () => {
    const lines = [
      { m01: "1000.50", m02: "2000" },
      { m01: "999.50", m12: "1" },
    ];
    const t = monthlyTotals(lines);
    expect(t.m01.toString()).toBe("2000");
    expect(t.m02.toString()).toBe("2000");
    expect(t.m12.toString()).toBe("1");
    expect(t.m06.toString()).toBe("0");
  });

  it("flujo mensual = ventas − gastos", () => {
    const ventas = monthlyTotals([{ m01: "5000000" }]);
    const gastos = monthlyTotals([{ m01: "3200000" }]);
    expect(monthlyFlow(ventas, gastos).m01.toString()).toBe("1800000");
  });

  it("acepta objetos Decimal de Prisma (duck-typed por toString)", () => {
    const prismaLike = { toString: () => "1234.56" };
    expect(dec(prismaLike).toString()).toBe("1234.56");
  });
});

describe("conversión de moneda", () => {
  it("USD → CLP → UF con los tipos de cambio del fondo", () => {
    expect(toClp("140000", "USD", FX).toString()).toBe("133000000");
    // USD 140.000 = CLP 133.000.000 = UF 3.392,857...
    expect(toUF("140000", "USD", FX).toDecimalPlaces(2).toString()).toBe("3392.86");
  });

  it("CLP es identidad; UF multiplica", () => {
    expect(toClp("1000", "CLP", FX).toString()).toBe("1000");
    expect(toClp("10", "UF", FX).toString()).toBe("392000");
  });

  it("rechaza fx en cero", () => {
    expect(() => toUF("100", "CLP", { ufToClp: "0", usdToClp: "950" })).toThrow();
  });
});

describe("matriz de aprobación N1–N6", () => {
  it("umbrales exactos: el límite superior pertenece al nivel inferior", () => {
    expect(approvalLevelForUF("500")).toBe(1);
    expect(approvalLevelForUF("500.01")).toBe(2);
    expect(approvalLevelForUF("2500")).toBe(2);
    expect(approvalLevelForUF("10000")).toBe(3);
    expect(approvalLevelForUF("50000")).toBe(4);
    expect(approvalLevelForUF("200000")).toBe(5);
    expect(approvalLevelForUF("200000.01")).toBe(6);
  });

  it("la iniciativa del seed (USD 140k) cae en N3 — directorio portfolio co", () => {
    expect(approvalLevelFor("140000", "USD", FX)).toBe(3);
  });

  it("la camioneta del seed (UF 900) cae en N2 — GM", () => {
    expect(approvalLevelFor("900", "UF", FX)).toBe(2);
  });
});

describe("cost overrun", () => {
  it("hasta +10% OK; +10–25% re-aprueba mismo nivel; >25% sube un nivel", () => {
    expect(overrunRule("100", "110").kind).toBe("OK");
    expect(overrunRule("100", "110.01").kind).toBe("REAPROBAR_MISMO_NIVEL");
    expect(overrunRule("100", "125").kind).toBe("REAPROBAR_MISMO_NIVEL");
    expect(overrunRule("100", "125.01").kind).toBe("SUBE_UN_NIVEL");
  });
});

describe("caso bancable", () => {
  it("cuota simple = monto / plazo (USD 140k a 18 meses ≈ 7.777,78)", () => {
    expect(estimatedInstallment("140000", 18).toDecimalPlaces(2).toString()).toBe("7777.78");
  });

  it("plazo inválido lanza error", () => {
    expect(() => estimatedInstallment("140000", 0)).toThrow();
    expect(() => estimatedInstallment("140000", -6)).toThrow();
  });
});

describe("formato es-CL", () => {
  it("CLP sin decimales, UF con dos, USD con símbolo", () => {
    expect(formatMoney("1234567", "CLP")).toMatch(/1\.234\.567/);
    expect(formatMoney("900", "UF")).toMatch(/UF 900,00/);
    expect(formatMoney(new Decimal("140000"), "USD")).toMatch(/140\.000/);
  });
});
