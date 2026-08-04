import Link from "next/link";
import { calcularAvisos } from "@/lib/avisos";
import { formatMoney, MONTH_KEYS, MONTH_LABELS, type CurrencyCode } from "@/lib/money";

/**
 * Panel de avisos de pago del dashboard. Server component autocontenido:
 * consulta, formatea y dibuja — el que lo monta solo decide el alcance
 * (una empresa para el encargado, todas para el circuito de pagos).
 *
 * Sin tabla de "leídos" a propósito: se recalcula en cada visita, así que
 * nunca muestra un aviso viejo ni pierde uno nuevo.
 */
export async function PanelAvisos({
  companyId,
  mostrarEmpresa,
}: {
  companyId?: string;
  /** true en la vista del fondo, donde conviven las 10 entidades. */
  mostrarEmpresa: boolean;
}) {
  const avisos = await calcularAvisos(companyId);
  const total = avisos.ocs.length + avisos.capex.length;
  const sinFecha = avisos.ocsSinFecha;
  if (total === 0 && sinFecha.cantidad === 0) return null;

  const etiquetaDias = (dias: number) =>
    dias < 0
      ? `vencida hace ${Math.abs(dias)} día(s)`
      : dias === 0
        ? "vence hoy"
        : `vence en ${dias} día(s)`;

  const etiquetaMeses = (meses: number, dueMonth: number) => {
    const mes = MONTH_LABELS[MONTH_KEYS[dueMonth - 1]];
    return meses < 0 ? `venció en ${mes}` : meses === 0 ? `vence este mes (${mes})` : `vence en ${mes}`;
  };

  return (
    <section className="rounded-xl border border-warn/30 bg-white">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-warn">
          Avisos de pago
        </h2>
        <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-xs font-semibold text-warn">
          {total > 0 ? total : sinFecha.cantidad}
        </span>
      </div>

      <ul className="divide-y divide-line/70">
        {avisos.ocs.map((a) => (
          <li key={`oc-${a.companyCode}-${a.referencia}`} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              {mostrarEmpresa && (
                <span className="text-xs font-semibold uppercase tracking-wide text-brand">
                  {a.companyCode}
                </span>
              )}
              <Link
                href={`/bancos${mostrarEmpresa ? `?empresa=${a.companyCode}` : ""}`}
                className="font-semibold text-ink hover:text-brand"
              >
                {a.referencia}
              </Link>
              <span className={`text-xs font-semibold ${a.diasParaVencer < 0 ? "text-danger" : "text-warn"}`}>
                {etiquetaDias(a.diasParaVencer)}
              </span>
              <span className="cell-num text-xs text-ink-soft">
                pendiente {formatMoney(a.pendiente, "CLP")} · avanzada {a.porcentaje}%
              </span>
            </div>
          </li>
        ))}

        {avisos.capex.map((a) => (
          <li key={`cx-${a.capexItemId}-${a.etapaLabel}`} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
              {mostrarEmpresa && (
                <span className="text-xs font-semibold uppercase tracking-wide text-brand">
                  {a.companyCode}
                </span>
              )}
              <Link href={`/capex/${a.capexItemId}`} className="font-semibold text-ink hover:text-brand">
                {a.descripcion}
              </Link>
              <span className="text-xs text-ink-soft">
                etapa «{a.etapaLabel}» ({a.percent.replace(/\.00$/, "")}%)
              </span>
              <span className={`text-xs font-semibold ${a.mesesParaVencer < 0 ? "text-danger" : "text-warn"}`}>
                {etiquetaMeses(a.mesesParaVencer, a.dueMonth)}
              </span>
              <span className="cell-num text-xs text-ink-soft">{formatMoney(a.monto, a.currency as CurrencyCode)}</span>
            </div>
          </li>
        ))}
      </ul>

      {sinFecha.cantidad > 0 && (
        <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-ink-soft">
          Además hay <strong className="text-ink">{sinFecha.cantidad}</strong> orden(es) de compra
          con saldo pendiente por <strong className="cell-num text-ink">{formatMoney(sinFecha.total, "CLP")}</strong>{" "}
          sin fecha de pago programada — el detalle está en{" "}
          <Link href="/bancos" className="font-semibold text-brand hover:text-brand-deep">
            Bancos
          </Link>
          . Al ponerles fecha (Editar en el movimiento), el aviso de vencimiento se activa solo.
        </p>
      )}
    </section>
  );
}
