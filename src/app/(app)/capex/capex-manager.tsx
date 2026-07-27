"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { LevelBadge } from "@/components/level-badge";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney, MONTH_LABELS, MONTH_KEYS, type CurrencyCode } from "@/lib/money";
import { deleteCapexItem, saveCapexItem } from "./actions";

export type CapexItemView = {
  id: string;
  description: string;
  purpose: string | null;
  amount: string;
  currency: CurrencyCode;
  amountClpLabel: string;
  monthNeeded: number;
  financingMonths: number | null;
  financingSource: string;
  isInitiative: boolean;
  initiativeName: string | null;
  approvalLevel: number | null;
  approvalStatus: string;
  linkedSales: number;
  linkedExpenses: number;
};

const SOURCE_LABELS: Record<string, string> = {
  CAJA_PROPIA: "Caja propia",
  BANCO: "Banco",
  FONDO: "Fondo",
  LEASING: "Leasing",
  MIXTO: "Mixto",
};

type FormState = {
  description: string;
  purpose: string;
  amount: string;
  currency: CurrencyCode;
  monthNeeded: number;
  financingMonths: string;
  financingSource: string;
  isInitiative: boolean;
  initiativeName: string;
};

const EMPTY_FORM: FormState = {
  description: "",
  purpose: "",
  amount: "",
  currency: "CLP",
  monthNeeded: 1,
  financingMonths: "",
  financingSource: "CAJA_PROPIA",
  isInitiative: false,
  initiativeName: "",
};

export function CapexManager({
  budgetId,
  items,
  editable,
}: {
  budgetId: string;
  items: CapexItemView[];
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(true);
  }

  function startEdit(item: CapexItemView) {
    setEditingId(item.id);
    setForm({
      description: item.description,
      purpose: item.purpose ?? "",
      amount: item.amount,
      currency: item.currency,
      monthNeeded: item.monthNeeded,
      financingMonths: item.financingMonths?.toString() ?? "",
      financingSource: item.financingSource,
      isInitiative: item.isInitiative,
      initiativeName: item.initiativeName ?? "",
    });
    setError(null);
    setOpen(true);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveCapexItem(budgetId, editingId, {
        ...form,
        financingMonths: form.financingMonths === "" ? null : Number(form.financingMonths),
      });
      if (result.ok) {
        setOpen(false);
        setForm(EMPTY_FORM);
        setEditingId(null);
      } else {
        setError(result.error);
      }
    });
  }

  function remove(item: CapexItemView) {
    if (!window.confirm(`¿Eliminar "${item.description}"? Las líneas vinculadas quedarán sin iniciativa.`)) return;
    startTransition(async () => {
      const result = await deleteCapexItem(item.id);
      if (!result.ok) setError(result.error);
    });
  }

  const field =
    "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-lavender-bg";

  return (
    <div className="space-y-4">
      {editable && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep"
          >
            + Agregar inversión
          </button>
        </div>
      )}

      {open && (
        <div className="rounded-xl border border-lavender bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
            {editingId ? "Editar inversión" : "Nueva inversión"}
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-medium text-ink-soft">¿Qué se compra o construye? *</span>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Ej: Local de venta en Pargua"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs font-medium text-ink-soft">¿Para qué? (propósito)</span>
              <input
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="Ej: venta a público de productos del mar"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Monto *</span>
              <input
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="140.000"
                inputMode="decimal"
                className={`${field} cell-num`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Moneda</span>
              <select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value as CurrencyCode })}
                className={field}
              >
                <option value="CLP">CLP</option>
                <option value="UF">UF</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Mes en que se requiere</span>
              <select
                value={form.monthNeeded}
                onChange={(e) => setForm({ ...form, monthNeeded: Number(e.target.value) })}
                className={field}
              >
                {MONTH_KEYS.map((k, i) => (
                  <option key={k} value={i + 1}>{MONTH_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Fuente de financiamiento</span>
              <select
                value={form.financingSource}
                onChange={(e) => setForm({ ...form, financingSource: e.target.value })}
                className={field}
              >
                {Object.entries(SOURCE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-soft">Plazo financiamiento (meses)</span>
              <input
                value={form.financingMonths}
                onChange={(e) => setForm({ ...form, financingMonths: e.target.value })}
                placeholder="Ej: 18"
                inputMode="numeric"
                className={`${field} cell-num`}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-2 md:col-span-2">
              <input
                type="checkbox"
                checked={form.isInitiative}
                onChange={(e) => setForm({ ...form, isInitiative: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              <span className="text-sm text-ink">
                Es una <strong>iniciativa</strong> (nuevo negocio con ventas y gastos propios)
              </span>
            </label>
            {form.isInitiative && (
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="text-xs font-medium text-ink-soft">Nombre de la iniciativa</span>
                <input
                  value={form.initiativeName}
                  onChange={(e) => setForm({ ...form, initiativeName: e.target.value })}
                  placeholder="Ej: Local Pargua"
                  className={field}
                />
              </label>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{error}</p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
            >
              {pending ? "Guardando…" : editingId ? "Guardar cambios" : "Agregar inversión"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-ink-soft transition hover:bg-soft"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && !open && (
        <p className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{error}</p>
      )}

      <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-max border-collapse text-left text-sm">
            <thead className="bg-soft text-xs font-semibold uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="border-b border-line px-4 py-3">Inversión</th>
                <th className="border-b border-line px-4 py-3 text-right">Monto</th>
                <th className="border-b border-line px-4 py-3">Mes</th>
                <th className="border-b border-line px-4 py-3">Financiamiento</th>
                <th className="border-b border-line px-4 py-3 text-center">Nivel</th>
                <th className="border-b border-line px-4 py-3">Estado</th>
                <th className="border-b border-line px-4 py-3">Caso bancable</th>
                <th className="w-24 border-b border-line px-2 py-3" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-sm text-ink-soft">
                    Aún no hay inversiones cargadas para este año.
                  </td>
                </tr>
              )}
              {items.map((item) => (
                <tr key={item.id} className="border-b border-line/70 align-top hover:bg-soft/60">
                  <td className="max-w-xs px-4 py-3">
                    <p className="font-medium text-ink">{item.description}</p>
                    {item.purpose && <p className="mt-0.5 text-xs text-ink-soft">{item.purpose}</p>}
                    {item.isInitiative && (
                      <span className="mt-1.5 inline-flex rounded-full bg-lavender-bg px-2 py-0.5 text-[11px] font-semibold text-brand">
                        Iniciativa · {item.initiativeName}
                      </span>
                    )}
                  </td>
                  <td className="cell-num px-4 py-3">
                    <p className="font-semibold text-ink">{formatMoney(item.amount, item.currency)}</p>
                    {item.currency !== "CLP" && (
                      <p className="text-xs text-ink-soft">{item.amountClpLabel}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">{MONTH_LABELS[MONTH_KEYS[item.monthNeeded - 1]]}</td>
                  <td className="px-4 py-3">
                    <p>{SOURCE_LABELS[item.financingSource] ?? item.financingSource}</p>
                    {item.financingMonths && (
                      <p className="text-xs text-ink-soft">{item.financingMonths} meses</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center"><LevelBadge level={item.approvalLevel} /></td>
                  <td className="px-4 py-3"><StatusBadge status={item.approvalStatus} /></td>
                  <td className="px-4 py-3">
                    {item.isInitiative ? (
                      <div>
                        <Link
                          href={`/capex/${item.id}`}
                          className="text-sm font-semibold text-brand hover:text-brand-deep"
                        >
                          Ver caso bancable →
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          {item.linkedSales} venta(s) · {item.linkedExpenses} gasto(s) vinculados
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right">
                    {editable && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-lavender-bg"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          aria-label={`Eliminar ${item.description}`}
                          className="rounded px-2 py-1 text-xs font-medium text-ink-soft hover:bg-danger-bg hover:text-danger"
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
