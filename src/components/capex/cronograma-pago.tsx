"use client";

import { useState, useTransition } from "react";
import { agregarEtapaPago, eliminarEtapaPago, marcarEtapaPagada } from "@/app/(app)/capex/actions";
import { MONTH_KEYS, MONTH_LABELS } from "@/lib/money";

/**
 * Cronograma de desembolso de una inversión por PORCENTAJES del monto total
 * (30% al pedido, 70% contra entrega…), en vez de cuotas mensuales iguales.
 * Los montos de cada etapa vienen YA CALCULADOS del servidor (regla de oro:
 * los agregados de dinero no se calculan en el cliente).
 */

export type EtapaView = {
  id: string;
  label: string;
  percent: string; // "30.00"
  dueMonth: number;
  monto: string; // formateado, ej. "$3.000.000"
  paid: boolean;
  paidAt: string | null; // dd-mm-aaaa ya formateado
  paidBy: string | null;
};

export function CronogramaPago({
  capexItemId,
  etapas,
  restante,
  editable,
  puedeMarcar,
}: {
  capexItemId: string;
  etapas: EtapaView[];
  /** Porcentaje aún sin asignar a ninguna etapa, ej. "40" — "0" si está completo. */
  restante: string;
  /** El presupuesto está editable y quien mira es la gerencia dueña. */
  editable: boolean;
  /** El rol puede marcar etapas como pagadas (operativo, aun aprobado). */
  puedeMarcar: boolean;
}) {
  const [form, setForm] = useState({ label: "", percent: "", dueMonth: "1" });
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function correr(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setForm({ label: "", percent: "", dueMonth: "1" });
    });
  }

  const completo = restante === "0";

  return (
    <section className="rounded-xl border border-line bg-white print:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
          Cronograma de pago por etapas
        </h2>
        <span className={`text-xs font-semibold ${completo ? "text-ok" : "text-warn"}`}>
          {completo ? "100% asignado" : `${restante}% sin asignar`}
        </span>
      </div>

      {etapas.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-soft">
          Sin etapas todavía. Definí el cronograma en porcentajes del monto total —
          por ejemplo 30% al pedido y 70% contra entrega — para que el panel avise
          cuando se acerque cada desembolso.
        </p>
      ) : (
        <ul>
          {etapas.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/70 px-5 py-3 last:border-b-0"
            >
              {puedeMarcar ? (
                <input
                  type="checkbox"
                  checked={e.paid}
                  disabled={pendiente}
                  onChange={(ev) => correr(() => marcarEtapaPagada(e.id, ev.target.checked))}
                  aria-label={`Marcar ${e.label} como pagada`}
                  className="h-4 w-4 accent-brand"
                />
              ) : (
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${e.paid ? "bg-ok" : "bg-line"}`}
                  aria-hidden="true"
                />
              )}
              <span className={`min-w-32 font-medium ${e.paid ? "text-ink-soft line-through" : "text-ink"}`}>
                {e.label}
              </span>
              <span className="cell-num text-sm font-semibold text-brand">{e.percent}%</span>
              <span className="cell-num text-sm text-ink">{e.monto}</span>
              <span className="text-xs text-ink-soft">
                vence {MONTH_LABELS[MONTH_KEYS[e.dueMonth - 1]]}
              </span>
              {e.paid && e.paidAt && (
                <span className="text-xs text-ok">
                  pagada el {e.paidAt}
                  {e.paidBy ? ` · ${e.paidBy}` : ""}
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={() => {
                    if (window.confirm(`¿Quitar la etapa “${e.label}”?`)) {
                      correr(() => eliminarEtapaPago(e.id));
                    }
                  }}
                  className="ml-auto text-xs text-ink-soft hover:text-danger"
                  aria-label={`Quitar etapa ${e.label}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && !completo && (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line bg-soft px-5 py-4 print:hidden"
          onSubmit={(ev) => {
            ev.preventDefault();
            correr(() =>
              agregarEtapaPago(capexItemId, {
                label: form.label,
                percent: form.percent,
                dueMonth: Number(form.dueMonth),
              }),
            );
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Etapa
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Anticipo, contra entrega…"
              className="h-9 w-44 rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            % del total
            <input
              value={form.percent}
              onChange={(e) => setForm({ ...form, percent: e.target.value })}
              placeholder={restante}
              inputMode="decimal"
              className="cell-num h-9 w-24 rounded-lg border border-line px-3 text-sm text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Mes de pago
            <select
              value={form.dueMonth}
              onChange={(e) => setForm({ ...form, dueMonth: e.target.value })}
              className="h-9 rounded-lg border border-line bg-white px-2 text-sm text-ink outline-none focus:border-brand"
            >
              {MONTH_KEYS.map((k, i) => (
                <option key={k} value={i + 1}>
                  {MONTH_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pendiente || !form.label.trim() || !form.percent.trim()}
            className="h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
          >
            {pendiente ? "Guardando…" : "Agregar etapa"}
          </button>
        </form>
      )}

      {error && (
        <p className="border-t border-line px-5 py-3 text-sm text-danger">{error}</p>
      )}
    </section>
  );
}
