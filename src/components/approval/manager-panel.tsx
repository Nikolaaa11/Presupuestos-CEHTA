"use client";

import { useState, useTransition } from "react";
import { submitBudget } from "@/app/(app)/budget-actions";

export function ManagerApprovalPanel({
  budgetId,
  status,
  lastObservation,
}: {
  budgetId: string;
  status: string;
  lastObservation: { comment: string; actor: string; date: string } | null;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = status === "BORRADOR" || status === "OBSERVADO";

  function send() {
    if (!window.confirm("¿Enviar el presupuesto al fondo? Quedará en solo lectura mientras se revisa.")) return;
    setError(null);
    startTransition(async () => {
      const result = await submitBudget(budgetId, comment);
      if (!result.ok) setError(result.error);
      else setComment("");
    });
  }

  return (
    <div className="rounded-xl border border-line bg-white p-5">
      {status === "OBSERVADO" && lastObservation && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn-bg px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-warn">
            Observación del fondo — {lastObservation.date}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-ink">{lastObservation.comment}</p>
          <p className="mt-1 text-xs text-ink-soft">{lastObservation.actor}</p>
        </div>
      )}

      {canSubmit ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-soft">
            {status === "OBSERVADO"
              ? "Corregí lo observado y reenviá el presupuesto al fondo."
              : "Cuando el presupuesto esté completo (ventas, gastos y CAPEX), envialo a revisión del fondo."}
          </p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comentario para el fondo (opcional)"
            rows={2}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-lavender-bg"
          />
          {error && <p className="rounded-lg bg-danger-bg px-3.5 py-2.5 text-sm text-danger">{error}</p>}
          <div>
            <button
              type="button"
              onClick={send}
              disabled={pending}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-60"
            >
              {pending ? "Enviando…" : status === "OBSERVADO" ? "Reenviar al fondo" : "Enviar al fondo"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">
          {status === "ENVIADO" && "Tu presupuesto está en revisión del fondo. Quedó en solo lectura."}
          {status === "APROBADO" && "Presupuesto aprobado por el fondo — versión inmutable de auditoría."}
          {status === "CERRADO" && "Presupuesto cerrado."}
        </p>
      )}
    </div>
  );
}
