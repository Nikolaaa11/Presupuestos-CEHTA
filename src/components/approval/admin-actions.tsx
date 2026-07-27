"use client";

import { useState, useTransition } from "react";
import { reviewBudget, reopenBudget } from "@/app/(app)/budget-actions";

/** Acciones del fondo sobre el presupuesto de una empresa (tarjeta del semáforo). */
export function AdminBudgetActions({ budgetId, status }: { budgetId: string; status: string }) {
  const [mode, setMode] = useState<"idle" | "observar" | "reabrir">("idle");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else {
        setMode("idle");
        setComment("");
      }
    });
  }

  if (status === "ENVIADO") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        {mode === "observar" ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="¿Qué debe corregir la gerencia? (obligatorio)"
              rows={2}
              autoFocus
              className="w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => reviewBudget(budgetId, "OBSERVAR", comment))}
                className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                {pending ? "Enviando…" : "Confirmar observación"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-soft"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("¿Aprobar este presupuesto? Quedará inmutable como versión de auditoría.")) {
                  run(() => reviewBudget(budgetId, "APROBAR", ""));
                }
              }}
              className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "…" : "Aprobar"}
            </button>
            <button
              type="button"
              onClick={() => setMode("observar")}
              className="rounded-lg border border-warn/40 bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn hover:opacity-90"
            >
              Observar
            </button>
          </div>
        )}
        {error && <p className="mt-2 rounded bg-danger-bg px-2 py-1.5 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  if (status === "APROBADO") {
    return (
      <div className="mt-3 border-t border-line pt-3">
        {mode === "reabrir" ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Motivo de la reapertura (obligatorio)"
              rows={2}
              autoFocus
              className="w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => reopenBudget(budgetId, comment))}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
              >
                {pending ? "Creando versión…" : "Confirmar reapertura"}
              </button>
              <button
                type="button"
                onClick={() => setMode("idle")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-soft"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMode("reabrir")}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-soft"
          >
            Reabrir (crea nueva versión)
          </button>
        )}
        {error && <p className="mt-2 rounded bg-danger-bg px-2 py-1.5 text-xs text-danger">{error}</p>}
      </div>
    );
  }

  return null;
}
