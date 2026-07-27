import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import {
  MONTH_KEYS,
  monthlyTotals,
  lineTotal,
  toClp,
  dec,
  type MonthKey,
  type CurrencyCode,
  type Fx,
} from "@/lib/money";

/**
 * Consolidación del fondo (F5) — SOLO FUND_ADMIN.
 * Toma la versión vigente (mayor) del presupuesto de cada entidad para el año
 * y produce: matriz mensual consolidada, mix de calidad de venta, pipeline CAPEX.
 * Todos los montos se serializan como string (aptos para Client Components).
 */

const FX_FALLBACK: Fx = { ufToClp: "39200", usdToClp: "950" };

export type MonthlyStr = Record<MonthKey, string>;

export type ConsolidationRow = {
  companyCode: string;
  companyName: string;
  status: string; // BudgetStatus o SIN_INICIAR
  version: number | null;
  ventas: MonthlyStr;
  gastos: MonthlyStr;
  flujo: MonthlyStr;
  ventasAnual: string;
  gastosAnual: string;
  flujoAnual: string;
  capexClp: string;
  capexCount: number;
  mix: { contrato: string; proyeccion: string; recurrente: string }; // % 0-100 (1 decimal)
};

export type CapexPipelineItem = {
  id: string;
  companyCode: string;
  description: string;
  initiativeName: string | null;
  isInitiative: boolean;
  amount: string;
  currency: CurrencyCode;
  amountClp: string;
  monthNeeded: number;
  financingMonths: number | null;
  financingSource: string;
  approvalLevel: number | null;
  approvalStatus: string;
};

export type FundConsolidation = {
  year: number;
  fx: { ufToClp: string; usdToClp: string };
  rows: ConsolidationRow[];
  totals: {
    ventas: MonthlyStr;
    gastos: MonthlyStr;
    flujo: MonthlyStr;
    ventasAnual: string;
    gastosAnual: string;
    flujoAnual: string;
    capexClp: string;
  };
  mix: { contrato: string; proyeccion: string; recurrente: string };
  capexPipeline: CapexPipelineItem[];
};

function toStrMap(m: Record<MonthKey, Decimal>): MonthlyStr {
  return Object.fromEntries(MONTH_KEYS.map((k) => [k, m[k].toString()])) as MonthlyStr;
}

function pct(part: Decimal, total: Decimal): string {
  if (total.isZero()) return "0";
  return part.div(total).times(100).toDecimalPlaces(1).toString();
}

/**
 * Carga única de los presupuestos vigentes de todas las entidades del año.
 *
 * Rendimiento: es la ÚNICA lectura pesada del fondo. La comparten la vista
 * consolidada y el export Excel; antes cada una hacía su propia consulta
 * completa (11 queries y los mismos datos dos veces por descarga).
 * Las líneas vienen ordenadas para que el export las use tal cual.
 */
export async function loadFundBudgets(year: number) {
  return prisma.company.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
    include: {
      budgets: {
        where: { year },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          salesLines: { orderBy: { sortOrder: "asc" } },
          expenseLines: { orderBy: { sortOrder: "asc" } },
          capexItems: { orderBy: [{ monthNeeded: "asc" }, { sortOrder: "asc" }] },
        },
      },
    },
  });
}

export type FundCompanies = Awaited<ReturnType<typeof loadFundBudgets>>;

async function requireFundAdminForConsolidation() {
  const user = await requireUser();
  if (user.role !== "FUND_ADMIN") throw new Error("Solo el fondo puede ver el consolidado");
  return user;
}

async function loadFx(year: number): Promise<Fx> {
  const fxRow = await prisma.fxRate.findUnique({ where: { year } });
  return fxRow
    ? { ufToClp: fxRow.ufToClp.toString(), usdToClp: fxRow.usdToClp.toString() }
    : FX_FALLBACK;
}

/**
 * Datos completos del fondo para el export: agregación + filas crudas, con UNA
 * sola lectura. El catálogo de categorías se trae aparte (tabla de 6 filas) en
 * vez de hacer un join por línea de gasto.
 */
export async function getFundExportData(year: number) {
  await requireFundAdminForConsolidation();
  const [companies, fx, categories] = await Promise.all([
    loadFundBudgets(year),
    loadFx(year),
    prisma.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    consolidation: aggregateFund(companies, fx, year),
    companies,
    fx,
    categoryNames: new Map(categories.map((c) => [c.id, c.name])),
  };
}

export async function getFundConsolidation(year: number): Promise<FundConsolidation> {
  await requireFundAdminForConsolidation();
  const [companies, fx] = await Promise.all([loadFundBudgets(year), loadFx(year)]);
  return aggregateFund(companies, fx, year);
}

/** Agregación pura (sin E/S): se ejecuta una vez sobre los datos ya cargados. */
function aggregateFund(companies: FundCompanies, fx: Fx, year: number): FundConsolidation {
  const zero = () =>
    Object.fromEntries(MONTH_KEYS.map((k) => [k, new Decimal(0)])) as Record<MonthKey, Decimal>;

  const totalVentas = zero();
  const totalGastos = zero();
  let totalCapexClp = new Decimal(0);
  let mixContrato = new Decimal(0);
  let mixProyeccion = new Decimal(0);
  let mixRecurrente = new Decimal(0);

  const rows: ConsolidationRow[] = [];
  const capexPipeline: CapexPipelineItem[] = [];

  for (const company of companies) {
    const budget = company.budgets[0];
    if (!budget) {
      rows.push({
        companyCode: company.code,
        companyName: company.name,
        status: "SIN_INICIAR",
        version: null,
        ventas: toStrMap(zero()),
        gastos: toStrMap(zero()),
        flujo: toStrMap(zero()),
        ventasAnual: "0",
        gastosAnual: "0",
        flujoAnual: "0",
        capexClp: "0",
        capexCount: 0,
        mix: { contrato: "0", proyeccion: "0", recurrente: "0" },
      });
      continue;
    }

    const ventas = monthlyTotals(budget.salesLines);
    const gastos = monthlyTotals(budget.expenseLines);
    const flujo = Object.fromEntries(
      MONTH_KEYS.map((k) => [k, ventas[k].minus(gastos[k])]),
    ) as Record<MonthKey, Decimal>;

    const ventasAnual = MONTH_KEYS.reduce((a, k) => a.plus(ventas[k]), new Decimal(0));
    const gastosAnual = MONTH_KEYS.reduce((a, k) => a.plus(gastos[k]), new Decimal(0));

    // Mix por tipo de venta (totales anuales por línea)
    let contrato = new Decimal(0);
    let proyeccion = new Decimal(0);
    let recurrente = new Decimal(0);
    for (const line of budget.salesLines) {
      const t = lineTotal(line);
      if (line.saleType === "CONTRATO") contrato = contrato.plus(t);
      else if (line.saleType === "RECURRENTE") recurrente = recurrente.plus(t);
      else proyeccion = proyeccion.plus(t);
    }

    const capexClp = budget.capexItems.reduce(
      (a, i) => a.plus(toClp(i.amount, i.currency as CurrencyCode, fx)),
      new Decimal(0),
    );

    for (const item of budget.capexItems) {
      capexPipeline.push({
        id: item.id,
        companyCode: company.code,
        description: item.description,
        initiativeName: item.initiativeName,
        isInitiative: item.isInitiative,
        amount: item.amount.toString(),
        currency: item.currency as CurrencyCode,
        amountClp: toClp(item.amount, item.currency as CurrencyCode, fx).toString(),
        monthNeeded: item.monthNeeded,
        financingMonths: item.financingMonths,
        financingSource: item.financingSource,
        approvalLevel: item.approvalLevel,
        approvalStatus: item.approvalStatus,
      });
    }

    for (const k of MONTH_KEYS) {
      totalVentas[k] = totalVentas[k].plus(ventas[k]);
      totalGastos[k] = totalGastos[k].plus(gastos[k]);
    }
    totalCapexClp = totalCapexClp.plus(capexClp);
    mixContrato = mixContrato.plus(contrato);
    mixProyeccion = mixProyeccion.plus(proyeccion);
    mixRecurrente = mixRecurrente.plus(recurrente);

    rows.push({
      companyCode: company.code,
      companyName: company.name,
      status: budget.status,
      version: budget.version,
      ventas: toStrMap(ventas),
      gastos: toStrMap(gastos),
      flujo: toStrMap(flujo),
      ventasAnual: ventasAnual.toString(),
      gastosAnual: gastosAnual.toString(),
      flujoAnual: ventasAnual.minus(gastosAnual).toString(),
      capexClp: capexClp.toString(),
      capexCount: budget.capexItems.length,
      mix: {
        contrato: pct(contrato, ventasAnual),
        proyeccion: pct(proyeccion, ventasAnual),
        recurrente: pct(recurrente, ventasAnual),
      },
    });
  }

  const totalFlujo = Object.fromEntries(
    MONTH_KEYS.map((k) => [k, totalVentas[k].minus(totalGastos[k])]),
  ) as Record<MonthKey, Decimal>;
  const ventasAnualTotal = MONTH_KEYS.reduce((a, k) => a.plus(totalVentas[k]), new Decimal(0));
  const gastosAnualTotal = MONTH_KEYS.reduce((a, k) => a.plus(totalGastos[k]), new Decimal(0));

  capexPipeline.sort((a, b) => a.monthNeeded - b.monthNeeded || dec(b.amountClp).comparedTo(dec(a.amountClp)));

  return {
    year,
    fx: { ufToClp: fx.ufToClp.toString(), usdToClp: fx.usdToClp.toString() },
    rows,
    totals: {
      ventas: toStrMap(totalVentas),
      gastos: toStrMap(totalGastos),
      flujo: toStrMap(totalFlujo),
      ventasAnual: ventasAnualTotal.toString(),
      gastosAnual: gastosAnualTotal.toString(),
      flujoAnual: ventasAnualTotal.minus(gastosAnualTotal).toString(),
      capexClp: totalCapexClp.toString(),
    },
    mix: {
      contrato: pct(mixContrato, ventasAnualTotal),
      proyeccion: pct(mixProyeccion, ventasAnualTotal),
      recurrente: pct(mixRecurrente, ventasAnualTotal),
    },
    capexPipeline,
  };
}
