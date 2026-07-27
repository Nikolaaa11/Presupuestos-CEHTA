import Decimal from "decimal.js";

/**
 * Lógica de dinero de Presupuestos CEHTA.
 * Regla de oro: nunca aritmética float sobre cifras monetarias.
 * Los Decimal de Prisma llegan como objetos con .toString() — acá se normalizan.
 */

export type DecimalInput = Decimal.Value | { toString(): string };

export function dec(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "object" ? value.toString() : value);
}

export const MONTH_KEYS = [
  "m01", "m02", "m03", "m04", "m05", "m06",
  "m07", "m08", "m09", "m10", "m11", "m12",
] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

export const MONTH_LABELS: Record<MonthKey, string> = {
  m01: "Ene", m02: "Feb", m03: "Mar", m04: "Abr", m05: "May", m06: "Jun",
  m07: "Jul", m08: "Ago", m09: "Sep", m10: "Oct", m11: "Nov", m12: "Dic",
};

export type MonthlyRecord = Partial<Record<MonthKey, DecimalInput>>;

/** Total anual de una línea (suma de los 12 meses). */
export function lineTotal(line: MonthlyRecord): Decimal {
  return MONTH_KEYS.reduce(
    (acc, k) => acc.plus(line[k] === undefined || line[k] === null ? 0 : dec(line[k]!)),
    new Decimal(0),
  );
}

/** Suma columna a columna de varias líneas → totales por mes. */
export function monthlyTotals(lines: MonthlyRecord[]): Record<MonthKey, Decimal> {
  const out = Object.fromEntries(MONTH_KEYS.map((k) => [k, new Decimal(0)])) as Record<MonthKey, Decimal>;
  for (const line of lines) {
    for (const k of MONTH_KEYS) {
      const v = line[k];
      if (v !== undefined && v !== null) out[k] = out[k].plus(dec(v));
    }
  }
  return out;
}

/** Flujo mensual = ventas − gastos, mes a mes. */
export function monthlyFlow(
  sales: Record<MonthKey, Decimal>,
  expenses: Record<MonthKey, Decimal>,
): Record<MonthKey, Decimal> {
  return Object.fromEntries(
    MONTH_KEYS.map((k) => [k, sales[k].minus(expenses[k])]),
  ) as Record<MonthKey, Decimal>;
}

// ─────────────────────────── Conversión de moneda ───────────────────────────

export type Fx = { ufToClp: DecimalInput; usdToClp: DecimalInput };
export type CurrencyCode = "CLP" | "UF" | "USD";

export function toClp(amount: DecimalInput, currency: CurrencyCode, fx: Fx): Decimal {
  const a = dec(amount);
  switch (currency) {
    case "CLP": return a;
    case "UF":  return a.times(dec(fx.ufToClp));
    case "USD": return a.times(dec(fx.usdToClp));
  }
}

export function toUF(amount: DecimalInput, currency: CurrencyCode, fx: Fx): Decimal {
  const ufToClp = dec(fx.ufToClp);
  if (ufToClp.isZero()) throw new Error("ufToClp no puede ser 0");
  return toClp(amount, currency, fx).div(ufToClp);
}

export function toUsd(amount: DecimalInput, currency: CurrencyCode, fx: Fx): Decimal {
  const usdToClp = dec(fx.usdToClp);
  if (usdToClp.isZero()) throw new Error("usdToClp no puede ser 0");
  return toClp(amount, currency, fx).div(usdToClp);
}

// ─────────────────────────── Formato es-CL ───────────────────────────

const clpFmt = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const usdFmt = new Intl.NumberFormat("es-CL", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const ufFmt = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

/** Formatea según moneda: $ 1.234.567 (CLP) · US$ 140.000 (USD) · UF 900,00 */
export function formatMoney(value: DecimalInput, currency: CurrencyCode): string {
  const n = dec(value).toNumber(); // solo para display — jamás para cálculo
  switch (currency) {
    case "CLP": return clpFmt.format(n);
    case "USD": return usdFmt.format(n);
    case "UF":  return `UF ${ufFmt.format(n)}`;
  }
}

/** Número plano es-CL sin símbolo (celdas de grilla). */
export function formatCell(value: DecimalInput): string {
  const n = dec(value).toNumber();
  return n === 0 ? "" : numFmt.format(n);
}
