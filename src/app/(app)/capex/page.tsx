import { CompanySelector } from "@/components/budget-grid/company-selector";
import { StatusBadge } from "@/components/status-badge";
import { prisma } from "@/lib/prisma";
import { BUDGET_YEAR, getCurrentBudget, isEditableStatus, resolveViewCompany } from "@/lib/budget";
import { formatMoney, toClp, type CurrencyCode, type Fx } from "@/lib/money";
import { CapexManager, type CapexItemView } from "./capex-manager";

const FX_FALLBACK: Fx = { ufToClp: "39200", usdToClp: "950" };

export default async function CapexPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { empresa } = await searchParams;
  const { user, company, readOnly } = await resolveViewCompany(empresa);
  const [budget, fxRow, companies] = await Promise.all([
    getCurrentBudget(company.id),
    prisma.fxRate.findUnique({ where: { year: BUDGET_YEAR } }),
    user.role === "FUND_ADMIN"
      ? prisma.company.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } })
      : Promise.resolve([]),
  ]);

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">CAPEX del año</h1>
        <p className="mt-1 text-sm text-ink-soft">{company.name}</p>
      </div>
      {user.role === "FUND_ADMIN" && <CompanySelector companies={companies} selectedCode={company.code} />}
    </header>
  );

  if (!budget) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-line bg-white p-10 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-ink">
            {readOnly ? "Presupuesto sin iniciar" : `Comenzar presupuesto ${BUDGET_YEAR}`}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
            {readOnly
              ? `${company.name} todavía no ha comenzado su presupuesto ${BUDGET_YEAR}.`
              : "El presupuesto se crea desde el módulo Ventas; después cargá acá las inversiones del año."}
          </p>
          {!readOnly && (
            <a href="/ventas" className="mt-6 inline-flex rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep">
              Ir a Ventas
            </a>
          )}
        </div>
      </div>
    );
  }

  const fx: Fx = fxRow
    ? { ufToClp: fxRow.ufToClp.toString(), usdToClp: fxRow.usdToClp.toString() }
    : FX_FALLBACK;

  const salesCount = new Map<string, number>();
  for (const l of budget.salesLines) {
    if (l.capexItemId) salesCount.set(l.capexItemId, (salesCount.get(l.capexItemId) ?? 0) + 1);
  }
  const expenseCount = new Map<string, number>();
  for (const l of budget.expenseLines) {
    if (l.capexItemId) expenseCount.set(l.capexItemId, (expenseCount.get(l.capexItemId) ?? 0) + 1);
  }

  const items: CapexItemView[] = budget.capexItems.map((i) => ({
    id: i.id,
    description: i.description,
    purpose: i.purpose,
    amount: i.amount.toString(),
    currency: i.currency as CurrencyCode,
    amountClpLabel: formatMoney(toClp(i.amount, i.currency as CurrencyCode, fx), "CLP"),
    monthNeeded: i.monthNeeded,
    financingMonths: i.financingMonths,
    financingSource: i.financingSource,
    isInitiative: i.isInitiative,
    initiativeName: i.initiativeName,
    approvalLevel: i.approvalLevel,
    approvalStatus: i.approvalStatus,
    linkedSales: salesCount.get(i.id) ?? 0,
    linkedExpenses: expenseCount.get(i.id) ?? 0,
  }));

  const totalClp = budget.capexItems.reduce(
    (a, i) => a.plus(toClp(i.amount, i.currency as CurrencyCode, fx)),
    toClp("0", "CLP", fx),
  );
  const editable = !readOnly && isEditableStatus(budget.status);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">CAPEX del año</h1>
          <p className="mt-1 text-sm text-ink-soft">{company.name}</p>
        </div>
        <div className="flex items-center gap-4">
          {user.role === "FUND_ADMIN" && <CompanySelector companies={companies} selectedCode={company.code} />}
          <StatusBadge status={budget.status} />
          <div className="text-right">
            <p className="text-xs text-ink-soft">CAPEX total (CLP)</p>
            <p className="text-xl font-bold text-ink">{formatMoney(totalClp, "CLP")}</p>
          </div>
        </div>
      </header>

      {!editable && (
        <div className="rounded-lg border border-lavender bg-lavender-bg px-4 py-3 text-sm font-medium text-brand-dark">
          Presupuesto {budget.status.toLocaleLowerCase("es-CL")} — solo lectura
        </div>
      )}

      <CapexManager budgetId={budget.id} items={items} editable={editable} />
    </div>
  );
}
