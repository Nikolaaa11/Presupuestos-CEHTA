import { CompanySelector } from "@/components/budget-grid/company-selector";
import { StatusBadge } from "@/components/status-badge";
import { BUDGET_YEAR, getCurrentBudget, isEditableStatus, resolveViewCompany } from "@/lib/budget";
import { MONTH_KEYS, type MonthKey } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { ExpenseGrid } from "./expense-grid";
import { startBudget } from "./actions";

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const { empresa } = await searchParams;
  const { user, company, readOnly } = await resolveViewCompany(empresa);
  const [budget, categories, companies] = await Promise.all([
    getCurrentBudget(company.id),
    prisma.expenseCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    user.role === "FUND_ADMIN"
      ? prisma.company.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } })
      : Promise.resolve([]),
  ]);

  if (!budget) {
    return (
      <div className="space-y-6">
        <ModuleHeader title="Presupuesto de Gastos" companyName={company.name}>
          {user.role === "FUND_ADMIN" && <CompanySelector companies={companies} selectedCode={company.code} />}
        </ModuleHeader>
        <div className="rounded-xl border border-line bg-white p-10 text-center shadow-sm">
          {readOnly ? (
            <>
              <h2 className="text-lg font-semibold text-ink">Presupuesto sin iniciar</h2>
              <p className="mt-2 text-sm text-ink-soft">{company.name} todavía no ha comenzado su presupuesto {BUDGET_YEAR}.</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">Comenzar presupuesto {BUDGET_YEAR}</h2>
              <p className="mt-2 text-sm text-ink-soft">Crea el borrador anual para comenzar a cargar ventas y gastos.</p>
              <form action={async () => { "use server"; await startBudget(); }} className="mt-6">
                <button className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep">Comenzar presupuesto</button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  const lines = budget.expenseLines
    .map((line) => {
      const months = Object.fromEntries(
        MONTH_KEYS.map((key) => [key, line[key].toString()]),
      ) as Record<MonthKey, string>;
      // El nombre de la categoría se resuelve en la grilla contra el catálogo:
      // no se serializa por línea (payload RSC más liviano, una query menos).
      return {
        id: line.id,
        categoryId: line.categoryId,
        item: line.item,
        capexItemId: line.capexItemId,
        sortOrder: line.sortOrder,
        ...months,
      };
    })
    .sort((a, b) => (categoryOrder.get(a.categoryId) ?? 999) - (categoryOrder.get(b.categoryId) ?? 999) || a.sortOrder - b.sortOrder);
  const initiatives = budget.capexItems
    .filter((item) => item.isInitiative)
    .map((item) => ({ id: item.id, label: item.initiativeName ?? item.description }));
  const editable = !readOnly && isEditableStatus(budget.status);

  return (
    <div className="space-y-5">
      {/* El total anual lo muestra la grilla (vivo, sin revalidar por celda). */}
      <ModuleHeader title="Presupuesto de Gastos" companyName={company.name}>
        <div className="flex items-center gap-4">
          {user.role === "FUND_ADMIN" && <CompanySelector companies={companies} selectedCode={company.code} />}
          <StatusBadge status={budget.status} />
        </div>
      </ModuleHeader>
      {!editable && <ReadOnlyBanner status={budget.status} />}
      <ExpenseGrid
        budgetId={budget.id}
        lines={lines}
        categories={categories}
        initiatives={initiatives}
        editable={editable}
        currency={budget.currency}
      />
    </div>
  );
}

function ModuleHeader({ title, companyName, children }: { title: string; companyName: string; children?: React.ReactNode }) {
  return <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-ink">{title}</h1><p className="mt-1 text-sm text-ink-soft">{companyName}</p></div>{children}</header>;
}

function ReadOnlyBanner({ status }: { status: string }) {
  return <div className="rounded-lg border border-lavender bg-lavender-bg px-4 py-3 text-sm font-medium text-brand-dark">Presupuesto {status.toLocaleLowerCase("es-CL")} — solo lectura</div>;
}
