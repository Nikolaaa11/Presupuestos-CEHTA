const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  BORRADOR: { label: "Borrador", className: "bg-soft text-ink-soft border-line" },
  ENVIADO: { label: "Enviado", className: "bg-lavender-bg text-brand-dark border-lavender" },
  REVISADO: { label: "Revisado", className: "bg-lavender-bg text-brand border-brand/40" },
  OBSERVADO: { label: "Observado", className: "bg-warn-bg text-warn border-warn/30" },
  APROBADO: { label: "Aprobado", className: "bg-ok-bg text-ok border-ok/30" },
  CERRADO: { label: "Cerrado", className: "bg-ink text-white border-ink" },
  RECHAZADO: { label: "Rechazado", className: "bg-danger-bg text-danger border-danger/30" },
  SIN_INICIAR: { label: "Sin iniciar", className: "bg-white text-ink-soft border-dashed border-line" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.SIN_INICIAR;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.className}`}
    >
      {s.label}
    </span>
  );
}
