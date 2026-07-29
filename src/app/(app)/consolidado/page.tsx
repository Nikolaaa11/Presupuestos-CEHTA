import Link from "next/link";
import { LevelBadge } from "@/components/level-badge";
import { StatusBadge } from "@/components/status-badge";
import { requireFundAdmin } from "@/lib/authz";
import { BUDGET_YEAR } from "@/lib/budget";
import {
  getFundConsolidation,
  type ConsolidationRow,
  type FundConsolidation,
} from "@/lib/consolidation";
import {
  MONTH_KEYS,
  MONTH_LABELS,
  dec,
  formatCell,
  formatMoney,
  type MonthKey,
} from "@/lib/money";

const SOURCE_LABELS: Record<string, string> = {
  CAJA_PROPIA: "Caja propia",
  BANCO: "Banco",
  LEASING: "Leasing",
  FONDO: "Fondo",
  MIXTO: "Mixto",
  OTRO: "Otro",
};

export default async function ConsolidadoPage({
  searchParams,
}: {
  searchParams: Promise<{ "año"?: string }>;
}) {
  await requireFundAdmin();
  const params = await searchParams;
  const year = Number(params["año"]) || BUDGET_YEAR;
  const consolidation = await getFundConsolidation(year);
  const flowIsNegative = dec(consolidation.totals.flujoAnual).isNegative();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">
            Consolidado del fondo {consolidation.year}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            FX vigente: UF {formatMoney(consolidation.fx.ufToClp, "CLP")} · USD{" "}
            {formatMoney(consolidation.fx.usdToClp, "CLP")}
          </p>
        </div>
        <a
          href="/api/export/consolidado"
          download
          className="inline-flex items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep"
        >
          Exportar Excel
        </a>
      </header>

      <section aria-labelledby="kpis-fondo">
        <h2 id="kpis-fondo" className="sr-only">
          Indicadores del fondo
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Ventas anuales"
            value={formatMoney(consolidation.totals.ventasAnual, "CLP")}
          />
          <KpiCard
            label="Gastos anuales"
            value={formatMoney(consolidation.totals.gastosAnual, "CLP")}
          />
          <KpiCard
            label="Flujo anual"
            value={formatMoney(consolidation.totals.flujoAnual, "CLP")}
            tone={flowIsNegative ? "danger" : "ok"}
          />
          <KpiCard
            label="CAPEX total CLP"
            value={formatMoney(consolidation.totals.capexClp, "CLP")}
          />
          <KpiCard
            label="Ventas ejecutadas"
            value={formatMoney(consolidation.totals.ventasRealAnual, "CLP")}
          />
          <KpiCard
            label="Gastos ejecutados"
            value={formatMoney(consolidation.totals.gastosRealAnual, "CLP")}
          />
          <KpiCard
            label="Flujo ejecutado"
            value={formatMoney(consolidation.totals.flujoRealAnual, "CLP")}
            tone={dec(consolidation.totals.flujoRealAnual).isNegative() ? "danger" : "ok"}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Mix de venta consolidado">
          <MixChip
            label="Contrato"
            value={consolidation.mix.contrato}
            className="bg-ok-bg text-ok"
          />
          <MixChip
            label="Proyección"
            value={consolidation.mix.proyeccion}
            className="bg-warn-bg text-warn"
          />
          <MixChip
            label="Recurrente"
            value={consolidation.mix.recurrente}
            className="bg-lavender-bg text-brand-dark"
          />
        </div>
      </section>

      <MonthlyChart consolidation={consolidation} />
      <CompanyTable consolidation={consolidation} />
      <MonthlyMatrices rows={consolidation.rows} />
      <CapexPipeline consolidation={consolidation} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p
        className={`mt-2 text-xl font-bold ${
          tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MixChip({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${className}`}>
      {label} {value}%
    </span>
  );
}

function MonthlyChart({ consolidation }: { consolidation: FundConsolidation }) {
  const maxValue = Math.max(
    0,
    ...MONTH_KEYS.flatMap((month) => [
      Number(consolidation.totals.ventas[month]),
      Number(consolidation.totals.gastos[month]),
    ]),
  );
  const barHeight = (value: string) =>
    maxValue === 0 ? 0 : Math.max(2, (Number(value) / maxValue) * 160);

  return (
    <section className="rounded-xl border border-line bg-white p-5" aria-labelledby="grafico-mensual">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="grafico-mensual" className="text-base font-bold text-ink">
          Ventas y gastos mensuales
        </h2>
        <div className="flex gap-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Ventas
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-lavender" /> Gastos
          </span>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto pb-1">
        <div className="flex h-56 min-w-[720px] items-end gap-3 border-b border-line px-2">
          {MONTH_KEYS.map((month) => {
            const negative = dec(consolidation.totals.flujo[month]).isNegative();
            return (
              <div key={month} className="flex min-w-0 flex-1 flex-col items-center">
                <div className="flex h-40 w-full items-end justify-center gap-1">
                  <div
                    className="w-3.5 rounded-t bg-brand sm:w-4"
                    style={{ height: `${barHeight(consolidation.totals.ventas[month])}px` }}
                    title={`Ventas ${MONTH_LABELS[month]}: ${formatMoney(consolidation.totals.ventas[month], "CLP")}`}
                  />
                  <div
                    className="w-3.5 rounded-t bg-lavender sm:w-4"
                    style={{ height: `${barHeight(consolidation.totals.gastos[month])}px` }}
                    title={`Gastos ${MONTH_LABELS[month]}: ${formatMoney(consolidation.totals.gastos[month], "CLP")}`}
                  />
                </div>
                <p className="mt-2 text-xs font-semibold text-ink">{MONTH_LABELS[month]}</p>
                <p className={`cell-num mt-0.5 text-[10px] ${negative ? "text-danger" : "text-ink-soft"}`}>
                  {formatCell(consolidation.totals.flujo[month]) || "0"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CompanyTable({ consolidation }: { consolidation: FundConsolidation }) {
  return (
    <section className="rounded-xl border border-line bg-white" aria-labelledby="tabla-empresas">
      <h2 id="tabla-empresas" className="border-b border-line px-5 py-4 text-base font-bold text-ink">
        Resumen por empresa
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-soft text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Estado</th>
              <th className="cell-num px-4 py-3">Ventas anual</th>
              <th className="cell-num px-4 py-3">Gastos anual</th>
              <th className="cell-num px-4 py-3">Flujo anual</th>
              <th className="cell-num px-4 py-3">Ventas ejec.</th>
              <th className="cell-num px-4 py-3">Gastos ejec.</th>
              <th className="cell-num px-4 py-3">CAPEX CLP</th>
              <th className="px-4 py-3">Mix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {consolidation.rows.map((row) => {
              const inactive = row.status === "SIN_INICIAR";
              const negative = dec(row.flujoAnual).isNegative();
              return (
                <tr key={row.companyCode} className={inactive ? "text-ink-soft" : "text-ink"}>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{row.companyCode}</span>
                    {row.version !== null && (
                      <span className="ml-2 rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                        v{row.version}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs font-normal text-ink-soft">
                      {row.companyName}
                    </span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="cell-num px-4 py-3">{formatCell(row.ventasAnual)}</td>
                  <td className="cell-num px-4 py-3">{formatCell(row.gastosAnual)}</td>
                  <td className={`cell-num px-4 py-3 font-medium ${negative ? "text-danger" : ""}`}>
                    {formatCell(row.flujoAnual)}
                  </td>
                  <td className="cell-num px-4 py-3">{formatCell(row.ventasRealAnual)}</td>
                  <td className="cell-num px-4 py-3">{formatCell(row.gastosRealAnual)}</td>
                  <td className="cell-num px-4 py-3">{formatCell(row.capexClp)}</td>
                  <td className="px-4 py-3"><MixBar mix={row.mix} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-brand-dark font-semibold text-white">
            <tr>
              <td className="px-4 py-3" colSpan={2}>TOTAL FONDO</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.ventasAnual)}</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.gastosAnual)}</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.flujoAnual)}</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.ventasRealAnual)}</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.gastosRealAnual)}</td>
              <td className="cell-num px-4 py-3">{formatCell(consolidation.totals.capexClp)}</td>
              <td className="px-4 py-3"><MixBar mix={consolidation.mix} dark /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function MixBar({
  mix,
  dark = false,
}: {
  mix: { contrato: string; proyeccion: string; recurrente: string };
  dark?: boolean;
}) {
  return (
    <div
      className={`flex h-2.5 w-32 overflow-hidden rounded-full ${dark ? "bg-white/20" : "bg-soft"}`}
      aria-label={`Contrato ${mix.contrato}%, proyección ${mix.proyeccion}%, recurrente ${mix.recurrente}%`}
    >
      <span className="bg-ok" style={{ width: `${Number(mix.contrato)}%` }} title={`Contrato ${mix.contrato}%`} />
      <span className="bg-warn" style={{ width: `${Number(mix.proyeccion)}%` }} title={`Proyección ${mix.proyeccion}%`} />
      <span className="bg-lavender" style={{ width: `${Number(mix.recurrente)}%` }} title={`Recurrente ${mix.recurrente}%`} />
    </div>
  );
}

function MonthlyMatrices({ rows }: { rows: ConsolidationRow[] }) {
  return (
    <section aria-labelledby="matrices-mensuales">
      <h2 id="matrices-mensuales" className="mb-3 text-base font-bold text-ink">
        Matriz mensual por empresa
      </h2>
      <div className="space-y-3">
        {rows.map((row) => (
          <details key={row.companyCode} className="group rounded-xl border border-line bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
              <span>
                <span className="font-semibold text-ink">{row.companyCode}</span>
                <span className="ml-2 text-sm text-ink-soft">{row.companyName}</span>
              </span>
              <span className="text-xs font-semibold text-brand group-open:hidden">Ver detalle</span>
              <span className="hidden text-xs font-semibold text-brand group-open:inline">Ocultar</span>
            </summary>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="bg-soft text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="px-4 py-2 text-left">Concepto</th>
                    {MONTH_KEYS.map((month) => (
                      <th key={month} className="cell-num px-3 py-2">{MONTH_LABELS[month]}</th>
                    ))}
                    <th className="cell-num px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <MatrixRow label="Ventas" values={row.ventas} total={row.ventasAnual} />
                  <MatrixRow label="Gastos" values={row.gastos} total={row.gastosAnual} />
                  <MatrixRow label="Flujo" values={row.flujo} total={row.flujoAnual} flow />
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function MatrixRow({
  label,
  values,
  total,
  flow = false,
}: {
  label: string;
  values: Record<MonthKey, string>;
  total: string;
  flow?: boolean;
}) {
  return (
    <tr>
      <th className="px-4 py-3 text-left font-semibold text-ink">{label}</th>
      {MONTH_KEYS.map((month) => {
        const negative = flow && dec(values[month]).isNegative();
        return (
          <td key={month} className={`cell-num px-3 py-3 ${negative ? "text-danger" : "text-ink"}`}>
            {formatCell(values[month])}
          </td>
        );
      })}
      <td className={`cell-num px-4 py-3 font-semibold ${flow && dec(total).isNegative() ? "text-danger" : "text-ink"}`}>
        {formatCell(total)}
      </td>
    </tr>
  );
}

function CapexPipeline({ consolidation }: { consolidation: FundConsolidation }) {
  return (
    <section className="rounded-xl border border-line bg-white" aria-labelledby="pipeline-capex">
      <h2 id="pipeline-capex" className="border-b border-line px-5 py-4 text-base font-bold text-ink">
        Pipeline CAPEX
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-soft text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">Mes requerido</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Inversión</th>
              <th className="cell-num px-4 py-3">Monto</th>
              <th className="px-4 py-3">Plazo / Fuente</th>
              <th className="px-4 py-3 text-center">Nivel</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"><span className="sr-only">Acción</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {consolidation.capexPipeline.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
                  No hay inversiones CAPEX cargadas.
                </td>
              </tr>
            ) : (
              consolidation.capexPipeline.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3">{MONTH_LABELS[MONTH_KEYS[item.monthNeeded - 1]]}</td>
                  <td className="px-4 py-3 font-semibold text-brand">{item.companyCode}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{item.description}</p>
                    {item.isInitiative && (
                      <span className="mt-1 inline-flex rounded-full bg-lavender-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-dark">
                        Iniciativa{item.initiativeName ? ` · ${item.initiativeName}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="cell-num whitespace-nowrap px-4 py-3">
                    <p>{formatMoney(item.amount, item.currency)}</p>
                    {item.currency !== "CLP" && (
                      <p className="text-xs text-ink-soft">{formatMoney(item.amountClp, "CLP")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <p>{item.financingMonths ? `${item.financingMonths} meses` : "Sin plazo"}</p>
                    <p className="text-xs text-ink-soft">
                      {SOURCE_LABELS[item.financingSource] ?? item.financingSource}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center"><LevelBadge level={item.approvalLevel} /></td>
                  <td className="px-4 py-3"><StatusBadge status={item.approvalStatus} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {item.isInitiative && (
                      <Link href={`/capex/${item.id}`} className="font-semibold text-brand hover:text-brand-deep">
                        Caso bancable →
                      </Link>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-brand-dark font-semibold text-white">
            <tr>
              <td colSpan={3} className="px-4 py-3">TOTAL CAPEX</td>
              <td className="cell-num px-4 py-3">{formatMoney(consolidation.totals.capexClp, "CLP")}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
