import { CompanySelector } from "@/components/budget-grid/company-selector";
import { ImportarExcel } from "@/components/budget-grid/importar-excel";
import { YearSelector } from "@/components/budget-grid/year-selector";
import { StatusBadge } from "@/components/status-badge";
import { getBudgetYears, getCurrentBudget, isEditableStatus, resolveViewCompany, resolveYear } from "@/lib/budget";
import { MONTH_KEYS, REAL_MONTH_KEYS, type MonthKey, type RealMonthKey } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { sugerenciasPagoGastos } from "@/lib/avisos";
import { ExpenseGrid } from "./expense-grid";
import { startBudget } from "./actions";

export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string; "año"?: string }>;
}) {
  const params = await searchParams;
  const empresa = params.empresa;
  const { user, company, readOnly } = await resolveViewCompany(empresa);
  const years = await getBudgetYears(company.id);
  const year = resolveYear(params["año"], years);
  const [budget, categories, companies] = await Promise.all([
    getCurrentBudget(company.id, year),
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
          <YearSelector years={years.length ? years : [year]} selected={year} />
        </ModuleHeader>
        <div className="rounded-xl border border-line bg-white p-10 text-center shadow-sm">
          {readOnly ? (
            <>
              <h2 className="text-lg font-semibold text-ink">Presupuesto sin iniciar</h2>
              <p className="mt-2 text-sm text-ink-soft">{company.name} todavía no ha comenzado su presupuesto {year}.</p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">Comenzar presupuesto {year}</h2>
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
  const sugerencias = await sugerenciasPagoGastos(budget.id);
  const lines = budget.expenseLines
    .map((line) => {
      const months = Object.fromEntries(
        MONTH_KEYS.map((key) => [key, line[key].toString()]),
      ) as Record<MonthKey, string>;
      // Ejecución real (los Excel traen PROYECTADO vs REAL por mes)
      const real = Object.fromEntries(
        REAL_MONTH_KEYS.map((key) => [key, line[key].toString()]),
      ) as Record<RealMonthKey, string>;
      // El nombre de la categoría se resuelve en la grilla contra el catálogo:
      // no se serializa por línea (payload RSC más liviano, una query menos).
      return {
        id: line.id,
        categoryId: line.categoryId,
        item: line.item,
        capexItemId: line.capexItemId,
        paid: line.paid,
        paidAt: line.paidAt?.toISOString() ?? null,
        sortOrder: line.sortOrder,
        ...months,
        ...real,
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
          <YearSelector years={years.length ? years : [year]} selected={year} />
          <StatusBadge status={budget.status} />
        </div>
      </ModuleHeader>
      {editable ? <EditableBanner /> : <ReadOnlyBanner status={budget.status} />}
      {editable && (
        <div className="flex justify-end">
          <ImportarExcel modulo="gastos" year={year} />
        </div>
      )}
      <ExpenseGrid
        budgetId={budget.id}
        lines={lines}
        categories={categories}
        initiatives={initiatives}
        editable={editable}
        currency={budget.currency}
        sugerencias={sugerencias}
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

function EditableBanner() {
  return <div className="rounded-lg border border-ok/30 bg-ok-bg px-4 py-3 text-sm font-medium text-ok">Presupuesto editable — podés modificar las cifras y enviarlo al fondo desde el Dashboard.</div>;
}
