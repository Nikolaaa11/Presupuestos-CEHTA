import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { StatusBadge } from "@/components/status-badge";
import { lineTotal, monthlyTotals, monthlyFlow, toClp, formatMoney, MONTH_KEYS, type CurrencyCode } from "@/lib/money";

const YEAR = 2027;
const FX_FALLBACK = { ufToClp: "39200", usdToClp: "950" };

export default async function DashboardPage() {
  const user = await requireUser();
  return user.role === "FUND_ADMIN" ? <AdminDashboard /> : <ManagerDashboard companyId={user.companyId!} />;
}

async function AdminDashboard() {
  const companies = await prisma.company.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
    include: {
      budgets: {
        where: { year: YEAR },
        orderBy: { version: "desc" },
        take: 1,
        select: { status: true, version: true, updatedAt: true },
      },
    },
  });

  return (
    <div>
      <h1 className="text-xl font-bold text-ink">Avance presupuesto {YEAR}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Estado de carga de las {companies.length} entidades del fondo
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => {
          const budget = c.budgets[0];
          return (
            <div key={c.id} className="rounded-xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">{c.code}</p>
                  <p className="mt-0.5 font-semibold text-ink">{c.name}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{c.sector}</p>
                </div>
                <StatusBadge status={budget?.status ?? "SIN_INICIAR"} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

async function ManagerDashboard({ companyId }: { companyId: string }) {
  const [budget, fx] = await Promise.all([
    prisma.budget.findFirst({
      where: { companyId, year: YEAR },
      orderBy: { version: "desc" },
      include: { salesLines: true, expenseLines: true, capexItems: true },
    }),
    prisma.fxRate.findUnique({ where: { year: YEAR } }),
  ]);

  if (!budget) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center">
        <h1 className="text-lg font-semibold text-ink">Aún no hay presupuesto {YEAR}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
          El presupuesto se crea desde el módulo de Ventas: cargá tus clientes mes a mes,
          después los gastos y el CAPEX del año.
        </p>
        <Link
          href="/ventas"
          className="mt-5 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep"
        >
          Comenzar presupuesto
        </Link>
      </div>
    );
  }

  const fxRates = fx
    ? { ufToClp: fx.ufToClp.toString(), usdToClp: fx.usdToClp.toString() }
    : FX_FALLBACK;

  const ventas = monthlyTotals(budget.salesLines);
  const gastos = monthlyTotals(budget.expenseLines);
  const flujo = monthlyFlow(ventas, gastos);

  const ventasAnual = budget.salesLines.reduce((a, l) => a.plus(lineTotal(l)), lineTotal({}));
  const gastosAnual = budget.expenseLines.reduce((a, l) => a.plus(lineTotal(l)), lineTotal({}));
  const flujoAnual = ventasAnual.minus(gastosAnual);
  const capexClp = budget.capexItems.reduce(
    (a, i) => a.plus(toClp(i.amount, i.currency as CurrencyCode, fxRates)),
    lineTotal({}),
  );

  const negMonths = MONTH_KEYS.filter((k) => flujo[k].isNegative()).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Presupuesto {YEAR} — v{budget.version}</h1>
          <p className="mt-1 text-sm text-ink-soft">Resumen anual de tu presupuesto</p>
        </div>
        <StatusBadge status={budget.status} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="Ventas anuales" value={formatMoney(ventasAnual, "CLP")} sub={`${budget.salesLines.length} líneas`} />
        <Card label="Gastos anuales" value={formatMoney(gastosAnual, "CLP")} sub={`${budget.expenseLines.length} ítems`} />
        <Card
          label="Flujo anual (V−G)"
          value={formatMoney(flujoAnual, "CLP")}
          sub={negMonths > 0 ? `${negMonths} mes(es) con flujo negativo` : "todos los meses positivos"}
          tone={flujoAnual.isNegative() ? "danger" : "ok"}
        />
        <Card label="CAPEX del año" value={formatMoney(capexClp, "CLP")} sub={`${budget.capexItems.length} ítem(s)`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ModuleLink href="/ventas" title="Ventas" desc="Clientes mes a mes, contrato vs proyección" />
        <ModuleLink href="/gastos" title="Gastos" desc="Ítems por categoría, recurrentes mensuales" />
        <ModuleLink href="/capex" title="CAPEX" desc="Inversiones del año y caso bancable" />
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "danger" }) {
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`mt-2 text-xl font-bold ${tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-ink"}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

function ModuleLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="group rounded-xl border border-line bg-white p-5 transition hover:border-lavender">
      <p className="font-semibold text-brand group-hover:text-brand-deep">{title} →</p>
      <p className="mt-1 text-sm text-ink-soft">{desc}</p>
    </Link>
  );
}
