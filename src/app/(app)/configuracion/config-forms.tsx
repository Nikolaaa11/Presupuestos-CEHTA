"use client";

import { useState, useTransition } from "react";
import { saveFxRate, addExpenseCategory, renameExpenseCategory } from "./actions";

type Result = { ok: true } | { ok: false; error: string };

const field =
  "rounded-lg border border-line px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-lavender-bg";

export function FxForm({
  year,
  ufToClp,
  usdToClp,
}: {
  year: number;
  ufToClp: string;
  usdToClp: string;
}) {
  const [uf, setUf] = useState(ufToClp);
  const [usd, setUsd] = useState(usdToClp);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMsg(null);
    startTransition(async () => {
      const result: Result = await saveFxRate(year, uf, usd);
      setMsg(
        result.ok
          ? { ok: true, text: "Tipos de cambio guardados. Aplican a conversiones y niveles N1–N6 de aquí en adelante." }
          : { ok: false, text: result.error },
      );
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-brand">
        Tipos de cambio {year}
      </h2>
      <p className="mt-1 text-xs text-ink-soft">
        Gobiernan la conversión a CLP del consolidado y el cálculo del nivel de aprobación N1–N6 del CAPEX.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">UF → CLP</span>
          <input value={uf} onChange={(e) => setUf(e.target.value)} inputMode="decimal" className={`${field} cell-num w-36`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">USD → CLP</span>
          <input value={usd} onChange={(e) => setUsd(e.target.value)} inputMode="decimal" className={`${field} cell-num w-36`} />
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
        >
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {msg && (
        <p className={`mt-3 rounded-lg px-3.5 py-2.5 text-sm ${msg.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

export function CategoriesManager({
  categories,
}: {
  categories: { id: string; name: string; isSystem: boolean; lines: number }[];
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<Result>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else onOk?.();
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-brand">Categorías de gasto</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Catálogo compartido por todas las empresas. Las categorías con líneas cargadas no se pueden eliminar (solo renombrar).
      </p>

      <ul className="mt-4 divide-y divide-line/70">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
            {editingId === c.id ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  className={`${field} flex-1`}
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => renameExpenseCategory(c.id, editName), () => setEditingId(null))}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-soft"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="text-sm font-medium text-ink">{c.name}</span>
                  <span className="ml-2 text-xs text-ink-soft">
                    {c.lines} línea(s){c.isSystem ? " · base" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditName(c.name);
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-brand hover:bg-lavender-bg"
                >
                  Renombrar
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-end gap-3 border-t border-line pt-4">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-ink-soft">Nueva categoría</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ej: Mantención y Repuestos"
            className={field}
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addExpenseCategory(newName), () => setNewName(""))}
          className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-lavender-bg disabled:opacity-60"
        >
          + Agregar
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
