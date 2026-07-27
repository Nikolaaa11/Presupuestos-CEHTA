import { approvalInfo } from "@/lib/capex";

/** Chip del nivel de aprobación N1–N6 con el aprobador como tooltip. */
export function LevelBadge({ level }: { level: number | null }) {
  if (!level) return <span className="text-xs text-ink-soft">—</span>;
  const info = approvalInfo(level);
  const strong = level >= 4;
  return (
    <span
      title={`${info.approver} · ${info.range}`}
      className={`inline-flex cursor-help items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
        strong
          ? "border-brand bg-brand text-white"
          : "border-lavender bg-lavender-bg text-brand-dark"
      }`}
    >
      N{level}
    </span>
  );
}
