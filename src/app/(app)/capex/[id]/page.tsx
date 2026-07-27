import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { bankableCase, coverageLabel } from "@/lib/bankable";
import { approvalInfo } from "@/lib/capex";
import { formatMoney, formatCell, MONTH_LABELS, MONTH_KEYS, type CurrencyCode, type Fx } from "@/lib/money";
import { PrintButton } from "@/components/print-button";

const FX_FALLBACK: Fx = { ufToClp: "39200", usdToClp: "950" };

const SOURCE_LABELS: Record<string, string> = {
  CAJA_PROPIA: "Caja propia",
  BANCO: "Financiamiento bancario",
  FONDO: "Aporte del fondo",
  LEASING: "Leasing",
  MIXTO: "Financiamiento mixto",
};

export default async function BankableCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const item = await prisma.capexItem.findUnique({
    where: { id },
    include: {
      budget: { include: { company: true } },
      salesLines: { orderBy: { sortOrder: "asc" } },
      expenseLines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!item) notFound();

  // Manager: solo su empresa. Admin: todas (lectura).
  if (user.role !== "FUND_ADMIN" && user.companyId !== item.budget.companyId) {
    redirect("/capex");
  }

  const fxRow = await prisma.fxRate.findUnique({ where: { year: item.budget.year } });
  const fx: Fx = fxRow
    ? { ufToClp: fxRow.ufToClp.toString(), usdToClp: fxRow.usdToClp.toString() }
    : FX_FALLBACK;

  const c = bankableCase({
    amount: item.amount.toString(),
    currency: item.currency as CurrencyCode,
    financingMonths: item.financingMonths,
    salesLines: item.salesLines,
    expenseLines: item.expenseLines,
    fx,
  });

  const name = item.initiativeName ?? item.description;
  const level = item.approvalLevel ? approvalInfo(item.approvalLevel) : null;
  const activeMonthRows = c.months.filter((m) => !m.sales.isZero() || !m.expenses.isZero() || !m.cumulative.isZero());

  return (
    <div className="mx-auto max-w-5xl space-y-6 print:max-w-none print:space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/capex" className="text-sm font-medium text-brand hover:text-brand-deep">
          ← Volver a CAPEX
        </Link>
        <PrintButton />
      </div>

      {/* Encabezado institucional */}
      <header className="rounded-xl border border-line bg-white p-6 print:border-0 print:p-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
          Cehta Capital · Caso de financiamiento
        </p>
        <h1 className="mt-2 text-2xl font-bold text-ink">{name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {item.budget.company.name} — Presupuesto {item.budget.year}
          {item.purpose ? ` · ${item.purpose}` : ""}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Fact label="Inversión (CAPEX)">
            <span className="text-lg font-bold text-ink">{formatMoney(item.amount, item.currency as CurrencyCode)}</span>
            {item.currency !== "CLP" && (
              <span className="block text-xs text-ink-soft">{formatMoney(c.amountClp, "CLP")}</span>
            )}
          </Fact>
          <Fact label="Se requiere en">
            <span className="text-lg font-bold text-ink">
              {MONTH_LABELS[MONTH_KEYS[item.monthNeeded - 1]]} {item.budget.year}
            </span>
          </Fact>
          <Fact label="Financiamiento">
            <span className="text-lg font-bold text-ink">
              {item.financingMonths ? `${item.financingMonths} meses` : "—"}
            </span>
            <span className="block text-xs text-ink-soft">
              {SOURCE_LABELS[item.financingSource] ?? item.financingSource}
            </span>
          </Fact>
          <Fact label="Nivel de aprobación">
            <span className="text-lg font-bold text-brand">
              {item.approvalLevel ? `N${item.approvalLevel}` : "—"}
            </span>
            {level && <span className="block text-xs text-ink-soft">{level.approver}</span>}
          </Fact>
        </div>
      </header>

      {/* Cuota y cobertura */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Cuota mensual estimada</p>
          <p className="mt-2 text-xl font-bold text-ink">
            {c.installmentClp ? formatMoney(c.installmentClp, "CLP") : "—"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">monto / plazo, sin tasa (referencial)</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Flujo mensual promedio</p>
          <p className="mt-2 text-xl font-bold text-ink">{formatMoney(c.avgMonthlyFlow, "CLP")}</p>
          <p className="mt-1 text-xs text-ink-soft">{c.activeMonths} mes(es) con actividad en el año 1</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Cobertura de la cuota</p>
          <p className="mt-2 text-xl font-bold text-ink">
            {c.monthsCovering !== null ? `${c.monthsCovering} de 12 meses` : "—"}
          </p>
          <p className="mt-1 text-xs text-ink-soft">{coverageLabel(c)}</p>
        </div>
      </section>

      {/* Flujo mensual de la iniciativa */}
      <section className="overflow-hidden rounded-xl border border-line bg-white">
        <h2 className="border-b border-line px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand">
          Flujo mensual de la iniciativa — año {item.budget.year} (CLP)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-soft text-xs font-semibold uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-4 py-2.5 text-left">Mes</th>
                <th className="px-4 py-2.5 text-right">Ventas vinculadas</th>
                <th className="px-4 py-2.5 text-right">Gastos vinculados</th>
                <th className="px-4 py-2.5 text-right">Flujo</th>
                <th className="px-4 py-2.5 text-right">Flujo acumulado</th>
              </tr>
            </thead>
            <tbody>
              {activeMonthRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-ink-soft">
                    Esta iniciativa aún no tiene líneas de venta o gasto vinculadas.
                    Vinculalas desde los módulos Ventas y Gastos (columna “Iniciativa”).
                  </td>
                </tr>
              )}
              {activeMonthRows.map((m) => (
                <tr key={m.key} className="border-t border-line/70">
                  <td className="px-4 py-2 font-medium text-ink">{MONTH_LABELS[m.key]}</td>
                  <td className="cell-num px-4 py-2">{formatCell(m.sales) || "0"}</td>
                  <td className="cell-num px-4 py-2">{formatCell(m.expenses) || "0"}</td>
                  <td className={`cell-num px-4 py-2 font-semibold ${m.flow.isNegative() ? "text-danger" : "text-ink"}`}>
                    {formatCell(m.flow) || "0"}
                  </td>
                  <td className={`cell-num px-4 py-2 ${m.cumulative.isNegative() ? "text-danger" : "text-ink-soft"}`}>
                    {formatCell(m.cumulative) || "0"}
                  </td>
                </tr>
              ))}
            </tbody>
            {activeMonthRows.length > 0 && (
              <tfoot className="bg-brand-dark text-white">
                <tr>
                  <th className="px-4 py-2.5 text-left text-sm">Total año 1</th>
                  <td className="cell-num px-4 py-2.5 font-semibold">{formatCell(c.totalSales) || "0"}</td>
                  <td className="cell-num px-4 py-2.5 font-semibold">{formatCell(c.totalExpenses) || "0"}</td>
                  <td className="cell-num px-4 py-2.5 font-bold">{formatCell(c.totalFlow) || "0"}</td>
                  <td className="cell-num px-4 py-2.5" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <p className="text-xs leading-relaxed text-ink-soft">
        Documento generado por Presupuestos CEHTA a partir del presupuesto {item.budget.year} de{" "}
        {item.budget.company.name}. Flujos proyectados por la gerencia; cuota referencial sin tasa de
        interés. Este material apoya la conversación con la entidad financiera: “con este flujo,
        financiame a {item.financingMonths ?? "N"} meses”.
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
