import { describe, it, expect } from "vitest";
import { bankableCase, coverageLabel } from "../bankable";

const FX = { ufToClp: "39200.00", usdToClp: "950.00" };

/** Réplica del caso del seed: Laboratorio CENERGY — USD 140.000 a 18 meses. */
const LAB = {
  amount: "140000",
  currency: "USD" as const,
  financingMonths: 18,
  // Ventas vinculadas: ramp de servicios (abr→dic) + certificaciones (jun→dic)
  salesLines: [
    { m04: "4000000", m05: "5000000", m06: "6000000", m07: "7000000", m08: "8000000", m09: "8000000", m10: "8000000", m11: "8000000", m12: "8000000" },
    { m06: "3000000", m07: "3000000", m08: "3000000", m09: "3000000", m10: "3000000", m11: "3000000", m12: "3000000" },
  ],
  // Gasto vinculado: 2 técnicos desde marzo
  expenseLines: [
    { m03: "5500000", m04: "5500000", m05: "5500000", m06: "5500000", m07: "5500000", m08: "5500000", m09: "5500000", m10: "5500000", m11: "5500000", m12: "5500000" },
  ],
  fx: FX,
};

describe("caso bancable — iniciativa Laboratorio (seed)", () => {
  const c = bankableCase(LAB);

  it("convierte el CAPEX a CLP con el FX del fondo", () => {
    expect(c.amountClp.toString()).toBe("133000000"); // 140.000 × 950
  });

  it("cuota estimada = monto/plazo (133M/18 ≈ 7.388.888,89)", () => {
    expect(c.installmentClp!.toDecimalPlaces(2).toString()).toBe("7388888.89");
  });

  it("flujo mensual = ventas − gastos vinculadas (jun: 9M−5,5M = 3,5M)", () => {
    const jun = c.months.find((m) => m.key === "m06")!;
    expect(jun.sales.toString()).toBe("9000000");
    expect(jun.expenses.toString()).toBe("5500000");
    expect(jun.flow.toString()).toBe("3500000");
  });

  it("acumulado del año: 83M ventas − 55M gastos = 28M", () => {
    expect(c.totalSales.toString()).toBe("83000000"); // 62M servicios + 21M certificaciones
    expect(c.totalExpenses.toString()).toBe("55000000");
    expect(c.totalFlow.toString()).toBe("28000000");
    expect(c.months[11].cumulative.toString()).toBe("28000000");
  });

  it("meses activos: mar→dic = 10; cobertura honesta (ningún mes cubre 7,39M)", () => {
    expect(c.activeMonths).toBe(10);
    expect(c.monthsCovering).toBe(0); // flujo máximo 5,5M < cuota 7,39M
    expect(c.avgMonthlyFlow.toDecimalPlaces(0).toString()).toBe("2800000"); // 28M/10
    expect(coverageLabel(c)).toMatch(/insuficiente/);
  });
});

describe("caso bancable — bordes", () => {
  it("sin plazo: cuota null y etiqueta clara", () => {
    const c = bankableCase({ ...LAB, financingMonths: null });
    expect(c.installmentClp).toBeNull();
    expect(c.monthsCovering).toBeNull();
    expect(coverageLabel(c)).toMatch(/Sin plazo/);
  });

  it("cobertura sólida cuando el flujo supera 120% de la cuota", () => {
    const c = bankableCase({
      amount: "10000000", currency: "CLP", financingMonths: 10, fx: FX,
      salesLines: [{ m01: "2000000", m02: "2000000", m03: "2000000" }],
      expenseLines: [],
    }); // cuota 1M, flujo 2M → ratio 2
    expect(c.monthsCovering).toBe(3);
    expect(coverageLabel(c)).toMatch(/sólida/);
  });

  it("iniciativa sin líneas vinculadas: todo en cero, sin división por cero", () => {
    const c = bankableCase({ ...LAB, salesLines: [], expenseLines: [] });
    expect(c.activeMonths).toBe(0);
    expect(c.avgMonthlyFlow.toString()).toBe("0");
    expect(c.totalFlow.toString()).toBe("0");
  });
});
