import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { getFundExportData } from "@/lib/consolidation";
import { MONTH_KEYS, MONTH_LABELS, lineTotal, toClp, type CurrencyCode } from "@/lib/money";

/**
 * Export Excel del consolidado del fondo — SOLO FUND_ADMIN.
 * Hojas: Resumen · Mensual · CAPEX · una hoja por empresa con el detalle de líneas.
 */

const YEAR_DEFAULT = 2027;
const MONTH_HDR = MONTH_KEYS.map((k) => MONTH_LABELS[k]);

const n = (s: string) => Number(s); // solo para celdas de Excel (display), nunca para calcular

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("No autenticado", { status: 401 });
  if (session.user.role !== "FUND_ADMIN") return new Response("Solo el fondo puede exportar", { status: 403 });

  const url = new URL(request.url);
  const year = Number(url.searchParams.get("año") ?? url.searchParams.get("year") ?? YEAR_DEFAULT) || YEAR_DEFAULT;

  // Una sola lectura del fondo alimenta el consolidado Y el detalle por empresa.
  const { consolidation: c, companies, fx, categoryNames } = await getFundExportData(year);
  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen ─────────────────────────────────────────────
  const resumen: (string | number)[][] = [
    [`Presupuestos CEHTA — Consolidado ${year}`],
    [`FX: UF ${c.fx.ufToClp} · USD ${c.fx.usdToClp} (CLP)`],
    [],
    ["Empresa", "Código", "Estado", "Versión", "Ventas anual", "Gastos anual", "Flujo anual", "CAPEX (CLP)", "% Contrato", "% Proyección", "% Recurrente"],
    ...c.rows.map((r) => [
      r.companyName, r.companyCode, r.status, r.version ?? "",
      n(r.ventasAnual), n(r.gastosAnual), n(r.flujoAnual), n(r.capexClp),
      n(r.mix.contrato), n(r.mix.proyeccion), n(r.mix.recurrente),
    ]),
    [],
    ["TOTAL FONDO", "", "", "", n(c.totals.ventasAnual), n(c.totals.gastosAnual), n(c.totals.flujoAnual), n(c.totals.capexClp), n(c.mix.contrato), n(c.mix.proyeccion), n(c.mix.recurrente)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");

  // ── Hoja 2: Mensual (ventas/gastos/flujo por empresa) ───────────
  const mensual: (string | number)[][] = [
    [`Matriz mensual ${year} (CLP)`],
    [],
    ["Empresa", "Concepto", ...MONTH_HDR, "Total"],
  ];
  for (const r of c.rows) {
    mensual.push([r.companyCode, "Ventas", ...MONTH_KEYS.map((k) => n(r.ventas[k])), n(r.ventasAnual)]);
    mensual.push([r.companyCode, "Gastos", ...MONTH_KEYS.map((k) => n(r.gastos[k])), n(r.gastosAnual)]);
    mensual.push([r.companyCode, "Flujo", ...MONTH_KEYS.map((k) => n(r.flujo[k])), n(r.flujoAnual)]);
  }
  mensual.push([]);
  mensual.push(["FONDO", "Ventas", ...MONTH_KEYS.map((k) => n(c.totals.ventas[k])), n(c.totals.ventasAnual)]);
  mensual.push(["FONDO", "Gastos", ...MONTH_KEYS.map((k) => n(c.totals.gastos[k])), n(c.totals.gastosAnual)]);
  mensual.push(["FONDO", "Flujo", ...MONTH_KEYS.map((k) => n(c.totals.flujo[k])), n(c.totals.flujoAnual)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mensual), "Mensual");

  // ── Hoja 3: Pipeline CAPEX ──────────────────────────────────────
  const capex: (string | number)[][] = [
    [`Pipeline CAPEX ${year}`],
    [],
    ["Empresa", "Inversión", "Iniciativa", "Monto", "Moneda", "Monto CLP", "Mes requerido", "Plazo (meses)", "Fuente", "Nivel", "Estado"],
    ...c.capexPipeline.map((i) => [
      i.companyCode, i.description, i.initiativeName ?? "", n(i.amount), i.currency, n(i.amountClp),
      MONTH_HDR[i.monthNeeded - 1], i.financingMonths ?? "", i.financingSource,
      i.approvalLevel ? `N${i.approvalLevel}` : "", i.approvalStatus,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(capex), "CAPEX");

  // ── Una hoja por empresa con detalle de líneas (datos ya cargados) ──
  for (const company of companies) {
    const budget = company.budgets[0];
    const sheet: (string | number)[][] = [
      [`${company.name} (${company.code}) — Presupuesto ${year}`],
      [budget ? `Estado: ${budget.status} · versión v${budget.version}` : "Sin iniciar"],
      [],
    ];
    if (budget) {
      sheet.push(["VENTAS", "Tipo", "Canal", ...MONTH_HDR, "Total"]);
      for (const l of budget.salesLines) {
        sheet.push([
          l.client, l.saleType, l.channel ?? "",
          ...MONTH_KEYS.map((k) => Number(l[k].toString())),
          Number(lineTotal(l).toString()),
        ]);
      }
      sheet.push([]);
      sheet.push(["GASTOS", "Categoría", "", ...MONTH_HDR, "Total"]);
      for (const l of budget.expenseLines) {
        sheet.push([
          l.item, categoryNames.get(l.categoryId) ?? "Sin categoría", "",
          ...MONTH_KEYS.map((k) => Number(l[k].toString())),
          Number(lineTotal(l).toString()),
        ]);
      }
      sheet.push([]);
      sheet.push(["CAPEX", "Monto", "Moneda", "Monto CLP", "Mes", "Plazo", "Fuente", "Nivel", "Estado"]);
      for (const i of budget.capexItems) {
        sheet.push([
          i.description, Number(i.amount.toString()), i.currency,
          Number(toClp(i.amount, i.currency as CurrencyCode, fx).toString()),
          MONTH_HDR[i.monthNeeded - 1], i.financingMonths ?? "", i.financingSource,
          i.approvalLevel ? `N${i.approvalLevel}` : "", i.approvalStatus,
        ]);
      }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), company.code.slice(0, 31));
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="presupuestos-cehta-${year}.xlsx"`,
    },
  });
}
