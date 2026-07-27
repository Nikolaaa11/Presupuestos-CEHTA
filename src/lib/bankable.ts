import Decimal from "decimal.js";
import {
  MONTH_KEYS,
  monthlyTotals,
  monthlyFlow,
  toClp,
  dec,
  type MonthKey,
  type MonthlyRecord,
  type DecimalInput,
  type CurrencyCode,
  type Fx,
} from "./money";
import { estimatedInstallment } from "./capex";

/**
 * Caso bancable de una iniciativa CAPEX — el argumento del audio del directorio:
 * "con este flujo que tengo, finánciame a 18 meses".
 *
 * Toma las líneas de venta y gasto VINCULADAS a la iniciativa y produce el
 * flujo mensual, la cuota estimada del financiamiento (monto/plazo, en CLP)
 * y la cobertura: cuántos meses del año el flujo de la iniciativa paga la cuota.
 * Cálculo simple sin tasa de interés (campo previsto para fase 2).
 */

export type BankableInput = {
  amount: DecimalInput;
  currency: CurrencyCode;
  financingMonths: number | null;
  salesLines: MonthlyRecord[];
  expenseLines: MonthlyRecord[];
  fx: Fx;
};

export type BankableMonth = {
  key: MonthKey;
  sales: Decimal;
  expenses: Decimal;
  flow: Decimal;
  cumulative: Decimal;
};

export type BankableCase = {
  amountClp: Decimal;
  installmentClp: Decimal | null; // null si no hay plazo definido
  months: BankableMonth[];
  totalSales: Decimal;
  totalExpenses: Decimal;
  totalFlow: Decimal;
  avgMonthlyFlow: Decimal; // promedio sobre los meses con actividad (venta o gasto ≠ 0)
  activeMonths: number;
  monthsCovering: number | null; // meses cuyo flujo ≥ cuota (null sin cuota)
  coverageRatio: Decimal | null; // flujo promedio / cuota (null sin cuota)
};

export function bankableCase(input: BankableInput): BankableCase {
  const amountClp = toClp(input.amount, input.currency, input.fx);
  const installmentClp =
    input.financingMonths && input.financingMonths > 0
      ? estimatedInstallment(amountClp, input.financingMonths)
      : null;

  const sales = monthlyTotals(input.salesLines);
  const expenses = monthlyTotals(input.expenseLines);
  const flow = monthlyFlow(sales, expenses);

  let cumulative = new Decimal(0);
  const months: BankableMonth[] = MONTH_KEYS.map((key) => {
    cumulative = cumulative.plus(flow[key]);
    return { key, sales: sales[key], expenses: expenses[key], flow: flow[key], cumulative };
  });

  const totalSales = months.reduce((a, m) => a.plus(m.sales), new Decimal(0));
  const totalExpenses = months.reduce((a, m) => a.plus(m.expenses), new Decimal(0));
  const totalFlow = totalSales.minus(totalExpenses);

  const active = months.filter((m) => !m.sales.isZero() || !m.expenses.isZero());
  const activeMonths = active.length;
  const avgMonthlyFlow = activeMonths === 0
    ? new Decimal(0)
    : active.reduce((a, m) => a.plus(m.flow), new Decimal(0)).div(activeMonths);

  const monthsCovering = installmentClp
    ? months.filter((m) => m.flow.greaterThanOrEqualTo(installmentClp)).length
    : null;
  const coverageRatio = installmentClp && !installmentClp.isZero()
    ? avgMonthlyFlow.div(installmentClp)
    : null;

  return {
    amountClp,
    installmentClp,
    months,
    totalSales,
    totalExpenses,
    totalFlow,
    avgMonthlyFlow,
    activeMonths,
    monthsCovering,
    coverageRatio,
  };
}

/** Etiqueta ejecutiva de cobertura para la UI (es-CL). */
export function coverageLabel(c: BankableCase): string {
  if (!c.installmentClp) return "Sin plazo de financiamiento definido";
  if (c.coverageRatio === null) return "Sin cuota estimable";
  const pct = c.coverageRatio.times(100).toDecimalPlaces(0).toString();
  if (c.coverageRatio.greaterThanOrEqualTo(1.2)) return `Cobertura sólida: flujo promedio ${pct}% de la cuota`;
  if (c.coverageRatio.greaterThanOrEqualTo(1)) return `Cobertura ajustada: flujo promedio ${pct}% de la cuota`;
  return `Cobertura insuficiente: flujo promedio ${pct}% de la cuota`;
}

/** dec re-export utilitario para las vistas del caso bancable. */
export { dec };
