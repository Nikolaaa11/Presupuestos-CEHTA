"use client";

import { useState, useTransition } from "react";
import { reviewBudget, reopenBudget } from "@/app/(app)/budget-actions";

type Resultado = { ok: true } | { ok: false; error: string };

/**
 * Acciones sobre el presupuesto de una empresa, según quién esté mirando:
 *   ENVIADO   → Victoria (o el dueño) revisa u observa
 *   REVISADO  → Guido aprueba u observa
 *   APROBADO  → Guido puede reabrir (crea versión nueva)
 * Los botones que el rol no puede ejecutar directamente no se muestran, y el
 * servidor los rechaza igual si alguien fuerza el pedido.
 */
export function AdminBudgetActions({
  budgetId,
  status,
  puedeRevisar,
  puedeAprobar,
  revisadoPorMi = false,
}: {
  budgetId: string;
  status: string;
  puedeRevisar: boolean;
  puedeAprobar: boolean;
  /** El visto bueno lo dio este mismo usuario: no puede además aprobar. */
  revisadoPorMi?: boolean;
}) {
  const [modo, setModo] = useState<"idle" | "observar" | "reabrir">("idle");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  function correr(fn: () => Promise<Resultado>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else { setModo("idle"); setComentario(""); }
    });
  }

  const cajaObservacion = (
    <div className="flex flex-col gap-2">
      <textarea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        placeholder="¿Qué debe corregir el encargado? (obligatorio)"
        rows={2}
        autoFocus
        className="w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-brand"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pendiente}
          onClick={() => correr(() => reviewBudget(budgetId, "OBSERVAR", comentario))}
          className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {pendiente ? "Enviando…" : "Confirmar observación"}
        </button>
        <button type="button" onClick={() => setModo("idle")}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-soft">
          Cancelar
        </button>
      </div>
    </div>
  );

  const mensajeError = error && (
    <p className="mt-2 rounded bg-danger-bg px-2 py-1.5 text-xs text-danger">{error}</p>
  );

  // ── Enviado: espera la revisión de la administradora ──
  if (status === "ENVIADO") {
    if (!puedeRevisar) {
      return (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
          Esperando la revisión de la administradora.
        </p>
      );
    }
    return (
      <div className="mt-3 border-t border-line pt-3">
        {modo === "observar" ? cajaObservacion : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendiente}
              onClick={() => {
                if (window.confirm("¿Dar el visto bueno? Queda a la espera de la aprobación del dueño.")) {
                  correr(() => reviewBudget(budgetId, "REVISAR", ""));
                }
              }}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
            >
              {pendiente ? "…" : "Revisar (visto bueno)"}
            </button>
            <button type="button" onClick={() => setModo("observar")}
              className="rounded-lg border border-warn/40 bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn hover:opacity-90">
              Observar
            </button>
          </div>
        )}
        {mensajeError}
      </div>
    );
  }

  // ── Revisado: espera la aprobación del dueño ──
  if (status === "REVISADO") {
    if (!puedeAprobar) {
      return (
        <p className="mt-3 border-t border-line pt-3 text-xs text-ink-soft">
          Revisado por administración — esperando la aprobación del dueño.
        </p>
      );
    }
    // Cuatro ojos: quien dio el visto bueno no firma además la aprobación.
    // El servidor lo rechaza igual; acá evitamos ofrecer un botón que fallaría.
    if (revisadoPorMi) {
      return (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-ink-soft">
            Diste el visto bueno: la aprobación la firma otra persona.
          </p>
          {modo === "observar" ? (
            <div className="mt-2">{cajaObservacion}</div>
          ) : (
            <button type="button" onClick={() => setModo("observar")}
              className="mt-2 rounded-lg border border-warn/40 bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn hover:opacity-90">
              Observar
            </button>
          )}
          {mensajeError}
        </div>
      );
    }
    return (
      <div className="mt-3 border-t border-line pt-3">
        {modo === "observar" ? cajaObservacion : (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pendiente}
              onClick={() => {
                if (window.confirm("¿Aprobar este presupuesto? Quedará inmutable como versión de auditoría.")) {
                  correr(() => reviewBudget(budgetId, "APROBAR", ""));
                }
              }}
              className="rounded-lg bg-ok px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {pendiente ? "…" : "Aprobar"}
            </button>
            <button type="button" onClick={() => setModo("observar")}
              className="rounded-lg border border-warn/40 bg-warn-bg px-3 py-1.5 text-xs font-semibold text-warn hover:opacity-90">
              Observar
            </button>
          </div>
        )}
        {mensajeError}
      </div>
    );
  }

  // ── Aprobado: el dueño puede reabrir creando una versión nueva ──
  if (status === "APROBADO" && puedeAprobar) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        {modo === "reabrir" ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Motivo de la reapertura (obligatorio)"
              rows={2}
              autoFocus
              className="w-full rounded-lg border border-line px-3 py-2 text-xs outline-none focus:border-brand"
            />
            <div className="flex gap-2">
              <button type="button" disabled={pendiente}
                onClick={() => correr(() => reopenBudget(budgetId, comentario))}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-deep disabled:opacity-60">
                {pendiente ? "Creando versión…" : "Confirmar reapertura"}
              </button>
              <button type="button" onClick={() => setModo("idle")}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-soft">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setModo("reabrir")}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-soft">
            Reabrir (crea nueva versión)
          </button>
        )}
        {mensajeError}
      </div>
    );
  }

  return null;
}
