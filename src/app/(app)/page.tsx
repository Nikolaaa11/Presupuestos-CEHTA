import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/authz";
import { StatusBadge } from "@/components/status-badge";
import { ManagerApprovalPanel } from "@/components/approval/manager-panel";
import { AdminBudgetActions } from "@/components/approval/admin-actions";
import { lineTotal, monthlyTotals, monthlyFlow, toClp, formatMoney, MONTH_KEYS, type CurrencyCode } from "@/lib/money";

const YEAR = 2027;
const FX_FALLBACK = { ufToClp: "39200", usdToClp: "950" };

const ACTION_LABELS: Record<string, string> = {
  ENVIADO: "envió el presupuesto",
  OBSERVADO: "observó el presupuesto",
  APROBADO: "aprobó el presupuesto",
  RECHAZADO: "rechazó",
  REABIERTO: "reabrió el presupuesto",
  CERRADO: "cerró el presupuesto",
};

function eventDate(d: Date): string {
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export default async function DashboardPage() {
  const user = await requireUser();
  return user.role === "FUND_ADMIN" ? <AdminDashboard /> : <ManagerDashboard companyId={user.companyId!} />;
}

// ─────────────────────────── Vista fondo ───────────────────────────

async function AdminDashboard() {
  const companies = await prisma.company.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
    include: {
      budgets: {
        where: { year: YEAR },
        orderBy: { version: "desc" },
        take: 1,
        include: {
          approvals: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { actor: { select: { name: true } } },
          },
        },
      },
    },
  });

  const pendings = companies.filter((c) => c.budgets[0]?.status === "ENVIADO").length;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Avance presupuesto {YEAR}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Estado de carga de las {companies.length} entidades del fondo
          </p>
        </div>
        {pendings > 0 && (
          <span className="rounded-full bg-lavender-bg px-3 py-1 text-xs font-semibold text-brand">
            {pendings} presupuesto(s) esperando revisión
          </span>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {companies.map((c) => {
          const budget = c.budgets[0];
          const lastEvent = budget?.approvals[0];
          return (
            <div key={c.id} className="flex flex-col rounded-xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                    {c.code}
                    {budget && budget.version > 1 && (
                      <span className="ml-2 rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                        v{budget.version}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-semibold text-ink">{c.name}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">{c.sector}</p>
                </div>
                <StatusBadge status={budget?.status ?? "SIN_INICIAR"} />
              </div>

              {lastEvent && (
                <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">{lastEvent.actor.name}</span>{" "}
                  {ACTION_LABELS[lastEvent.action] ?? lastEvent.action} · {eventDate(lastEvent.createdAt)}
                  {lastEvent.comment && <span className="block italic">“{lastEvent.comment}”</span>}
                </p>
              )}

              {budget && (
                <div className="mt-auto">
                  <AdminBudgetActions budgetId={budget.id} status={budget.status} />
                  <div className="mt-3 flex gap-3 border-t border-line pt-3 text-xs">
                    <Link className="font-medium text-brand hover:text-brand-deep" href={`/ventas?empresa=${c.code}`}>Ventas</Link>
                    <Link className="font-medium text-brand hover:text-brand-deep" href={`/gastos?empresa=${c.code}`}>Gastos</Link>
                    <Link className="font-medium text-brand hover:text-brand-deep" href={`/capex?empresa=${c.code}`}>CAPEX</Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────── Vista gerencia ───────────────────────────

async function ManagerDashboard({ companyId }: { companyId: string }) {
  const [budget, fx, events] = await Promise.all([
    prisma.budget.findFirst({
      where: { companyId, year: YEAR },
      orderBy: { version: "desc" },
      include: { salesLines: true, expenseLines: true, capexItems: true },
    }),
    prisma.fxRate.findUnique({ where: { year: YEAR } }),
    prisma.approvalEvent.findMany({
      where: { budget: { companyId, year: YEAR } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { name: true, role: true } }, budget: { select: { version: true } } },
    }),
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
  const lastObservation = events.find((e) => e.action === "OBSERVADO");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Presupuesto {YEAR} — v{budget.version}</h1>
          <p className="mt-1 text-sm text-ink-soft">Resumen anual de tu presupuesto</p>
        </div>
        <StatusBadge status={budget.status} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <ManagerApprovalPanel
        budgetId={budget.id}
        status={budget.status}
        lastObservation={
          lastObservation
            ? {
                comment: lastObservation.comment ?? "",
                actor: lastObservation.actor.name,
                date: eventDate(lastObservation.createdAt),
              }
            : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ModuleLink href="/ventas" title="Ventas" desc="Clientes mes a mes, contrato vs proyección" />
        <ModuleLink href="/gastos" title="Gastos" desc="Ítems por categoría, recurrentes mensuales" />
        <ModuleLink href="/capex" title="CAPEX" desc="Inversiones del año y caso bancable" />
      </div>

      {events.length > 0 && (
        <section className="rounded-xl border border-line bg-white">
          <h2 className="border-b border-line px-5 py-3 text-sm font-bold uppercase tracking-wide text-brand">
            Historial
          </h2>
          <ul className="divide-y divide-line/70">
            {events.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <span className="font-medium text-ink">{e.actor.name}</span>{" "}
                <span className="text-ink-soft">{ACTION_LABELS[e.action] ?? e.action} (v{e.budget.version}) · {eventDate(e.createdAt)}</span>
                {e.comment && <p className="mt-0.5 text-xs italic text-ink-soft">“{e.comment}”</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
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
