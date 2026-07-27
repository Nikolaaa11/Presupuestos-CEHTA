import Decimal from "decimal.js";
import { dec, toUF, type DecimalInput, type CurrencyCode, type Fx } from "./money";

/**
 * Gobernanza CAPEX — matriz de niveles de aprobación (LOA) del fondo.
 * El nivel se calcula SIEMPRE server-side a partir del monto convertido a UF.
 * Umbrales default de la política CEHTA (configurables a futuro por FUND_ADMIN).
 */

export type ApprovalLevelInfo = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  approver: string;
  range: string;
};

export const APPROVAL_LEVELS: ApprovalLevelInfo[] = [
  { level: 1, approver: "Gerente operativo",          range: "hasta UF 500" },
  { level: 2, approver: "GM portfolio company",       range: "UF 500 – 2.500" },
  { level: 3, approver: "Directorio portfolio co",    range: "UF 2.500 – 10.000" },
  { level: 4, approver: "Comité de Inversiones FIP",  range: "UF 10.000 – 50.000" },
  { level: 5, approver: "Directorio AFIS",            range: "UF 50.000 – 200.000" },
  { level: 6, approver: "Asamblea de Aportantes",     range: "sobre UF 200.000" },
];

/** Umbrales superiores (exclusivos) de cada nivel, en UF. N6 no tiene techo. */
const UF_THRESHOLDS: ReadonlyArray<{ level: 1 | 2 | 3 | 4 | 5; maxUF: number }> = [
  { level: 1, maxUF: 500 },
  { level: 2, maxUF: 2_500 },
  { level: 3, maxUF: 10_000 },
  { level: 4, maxUF: 50_000 },
  { level: 5, maxUF: 200_000 },
];

/** Nivel de aprobación por monto en UF. Límite superior inclusive (UF 500 exactas = N1). */
export function approvalLevelForUF(amountUF: DecimalInput): 1 | 2 | 3 | 4 | 5 | 6 {
  const uf = dec(amountUF).abs();
  for (const t of UF_THRESHOLDS) {
    if (uf.lessThanOrEqualTo(t.maxUF)) return t.level;
  }
  return 6;
}

/** Nivel de aprobación de un ítem CAPEX en su moneda original. */
export function approvalLevelFor(
  amount: DecimalInput,
  currency: CurrencyCode,
  fx: Fx,
): 1 | 2 | 3 | 4 | 5 | 6 {
  return approvalLevelForUF(toUF(amount, currency, fx));
}

export function approvalInfo(level: number): ApprovalLevelInfo {
  const found = APPROVAL_LEVELS.find((l) => l.level === level);
  if (!found) throw new Error(`Nivel de aprobación inválido: ${level}`);
  return found;
}

/**
 * Regla de cost overrun de la política:
 *  - aumento > 10% sobre lo aprobado → re-aprobación al MISMO nivel
 *  - aumento > 25% → sube UN nivel
 * (informativa en fase 1; enforcement en fase 3)
 */
export function overrunRule(approved: DecimalInput, actual: DecimalInput):
  | { kind: "OK" }
  | { kind: "REAPROBAR_MISMO_NIVEL"; pct: Decimal }
  | { kind: "SUBE_UN_NIVEL"; pct: Decimal } {
  const a = dec(approved);
  if (a.isZero()) return { kind: "OK" };
  const pct = dec(actual).minus(a).div(a).times(100);
  if (pct.greaterThan(25)) return { kind: "SUBE_UN_NIVEL", pct };
  if (pct.greaterThan(10)) return { kind: "REAPROBAR_MISMO_NIVEL", pct };
  return { kind: "OK" };
}

/**
 * Cobertura bancable simple (fase 1):
 * cuota estimada = monto / plazo; se compara contra el flujo mensual de la iniciativa.
 * (tasa de interés: campo previsto para fase 2)
 */
export function estimatedInstallment(amount: DecimalInput, months: number): Decimal {
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("El plazo de financiamiento debe ser un entero positivo de meses");
  }
  return dec(amount).div(months);
}
