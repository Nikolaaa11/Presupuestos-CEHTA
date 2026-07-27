"use client";

import {
  Fragment,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { formatCell, lineTotal, MONTH_KEYS, MONTH_LABELS, monthlyTotals, type MonthKey } from "@/lib/money";
import type { ActionResult, GridLine, MonthPatch } from "./types";

type Props<T extends GridLine> = {
  budgetId: string;
  lines: T[];
  editable: boolean;
  metadataHeaders: string[];
  renderMetadata: (
    line: T,
    update: <K extends keyof T>(key: K, value: T[K]) => Promise<void>,
    disabled: boolean,
  ) => ReactNode;
  updateMeta: (lineId: string, data: Record<string, unknown>) => Promise<ActionResult>;
  updateMonths: (lineId: string, patch: MonthPatch) => Promise<ActionResult>;
  bulkUpdate: (budgetId: string, updates: { lineId: string; patch: MonthPatch }[]) => Promise<ActionResult>;
  addLine: (budgetId: string) => Promise<ActionResult>;
  deleteLine: (lineId: string) => Promise<ActionResult>;
  emptyLabel: string;
  groupKey?: (line: T) => string;
  groupLabel?: (line: T) => string;
};

function normalizeAmount(value: string): string | null {
  const compact = value.trim().replace(/\s/g, "");
  if (compact === "") return "0";
  let normalized = compact;
  if (compact.includes(",")) {
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else {
    const dots = compact.match(/\./g)?.length ?? 0;
    if (dots > 1 || (dots === 1 && /^\d{1,3}\.\d{3}$/.test(compact))) {
      normalized = compact.replace(/\./g, "");
    }
  }
  return /^\d{1,12}(\.\d{1,2})?$/.test(normalized) ? normalized : null;
}

function MoneyInput({
  value,
  disabled,
  rowIndex,
  monthIndex,
  onCommit,
  onPaste,
}: {
  value: string;
  disabled: boolean;
  rowIndex: number;
  monthIndex: number;
  onCommit: (value: string) => Promise<void>;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  async function commit() {
    setEditing(false);
    const normalized = normalizeAmount(draft);
    if (normalized === null) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    if (normalized !== value) await onCommit(normalized);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit().then(() => {
        document
          .querySelector<HTMLInputElement>(`[data-money-cell="${rowIndex + 1}-${monthIndex}"]`)
          ?.focus();
      });
    }
    if (event.key === "Escape") {
      setDraft(value);
      setEditing(false);
      event.currentTarget.blur();
    }
  }

  return (
    <input
      data-money-cell={`${rowIndex}-${monthIndex}`}
      value={editing ? draft : formatCell(value)}
      disabled={disabled}
      inputMode="decimal"
      aria-label={`${MONTH_LABELS[MONTH_KEYS[monthIndex]]}, fila ${rowIndex + 1}`}
      onFocus={() => {
        setDraft(value === "0" ? "" : value);
        setEditing(true);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      className="cell-num h-9 w-24 rounded border border-transparent bg-transparent px-2 text-sm text-ink outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white disabled:cursor-default"
    />
  );
}

export function AmountGrid<T extends GridLine>({
  budgetId,
  lines: initialLines,
  editable,
  metadataHeaders,
  renderMetadata,
  updateMeta,
  updateMonths,
  bulkUpdate,
  addLine,
  deleteLine,
  emptyLabel,
  groupKey,
  groupLabel,
}: Props<T>) {
  const [lines, setLines] = useState(initialLines);
  const [sourceLines, setSourceLines] = useState(initialLines);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [, startTransition] = useTransition();
  const previousLength = useRef(initialLines.length);

  if (initialLines !== sourceLines) {
    setSourceLines(initialLines);
    setLines(initialLines);
  }
  useEffect(() => {
    if (initialLines.length > previousLength.current) {
      document.querySelector<HTMLInputElement>(`[data-meta-row="${initialLines.length - 1}"]`)?.focus();
    }
    previousLength.current = initialLines.length;
  }, [initialLines.length]);

  const totals = useMemo(() => monthlyTotals(lines), [lines]);
  const grandTotal = useMemo(() => lineTotal(totals), [totals]);
  const displayedLines = useMemo(
    () => groupKey
      ? [...lines].sort((left, right) => groupKey(left).localeCompare(groupKey(right)))
      : lines,
    [groupKey, lines],
  );

  async function run(action: () => Promise<ActionResult>, rollback?: () => void) {
    setPendingCount((count) => count + 1);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        rollback?.();
        setMessage(result.error);
      }
    } catch {
      rollback?.();
      setMessage("No fue posible guardar. Revisa tu conexión e inténtalo nuevamente.");
    } finally {
      setPendingCount((count) => count - 1);
    }
  }

  async function commitMonth(lineId: string, key: MonthKey, value: string) {
    const previous = lines.find((line) => line.id === lineId)?.[key] ?? "0";
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [key]: value } : line)));
    await run(
      () => updateMonths(lineId, { [key]: value }),
      () => setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [key]: previous } : line))),
    );
  }

  async function commitMeta<K extends keyof T>(lineId: string, key: K, value: T[K]) {
    const previous = lines.find((line) => line.id === lineId)?.[key];
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [key]: value } : line)));
    await run(
      () => updateMeta(lineId, { [key]: value }),
      () => {
        if (previous !== undefined) {
          setLines((current) => current.map((line) => (line.id === lineId ? { ...line, [key]: previous } : line)));
        }
      },
    );
  }

  function pasteBlock(event: ClipboardEvent<HTMLInputElement>, anchorRow: number, anchorMonth: number) {
    if (!editable) return;
    const rows = event.clipboardData.getData("text").replace(/\r/g, "").split("\n").filter((row) => row !== "");
    if (rows.length === 0) return;
    event.preventDefault();
    const updates = new Map<string, MonthPatch>();
    const next = displayedLines.map((line) => ({ ...line }));
    rows.forEach((row, rowOffset) => {
      const target = next[anchorRow + rowOffset];
      if (!target) return;
      row.split("\t").forEach((cell, colOffset) => {
        const key = MONTH_KEYS[anchorMonth + colOffset];
        const value = normalizeAmount(cell);
        if (!key || value === null) return;
        target[key] = value;
        updates.set(target.id, { ...(updates.get(target.id) ?? {}), [key]: value });
      });
    });
    if (updates.size === 0) return;
    const previous = lines;
    setLines(next);
    void run(
      () => bulkUpdate(budgetId, [...updates].map(([lineId, patch]) => ({ lineId, patch }))),
      () => setLines(previous),
    );
  }

  const categoryTotals = (key: string) => monthlyTotals(lines.filter((line) => groupKey?.(line) === key));

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="flex min-h-11 items-center justify-between border-b border-line px-4 py-2">
        <p className="text-xs text-ink-soft">
          {pendingCount > 0 ? "Guardando…" : message ? <span className="text-danger">Error: {message}</span> : "Guardado ✓"}
        </p>
        <p className="text-xs text-ink-soft">Puedes pegar bloques desde Excel en cualquier mes.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-left">
          <thead className="bg-soft text-xs font-semibold uppercase tracking-wide text-ink-soft">
            <tr>
              {metadataHeaders.map((header) => (
                <th key={header} className="sticky left-0 z-10 border-b border-r border-line bg-soft px-3 py-3 first:min-w-48">
                  {header}
                </th>
              ))}
              {MONTH_KEYS.map((key) => (
                <th key={key} className="min-w-24 border-b border-line px-2 py-3 text-right">{MONTH_LABELS[key]}</th>
              ))}
              <th className="min-w-28 border-b border-l border-line px-3 py-3 text-right">Total</th>
              <th className="w-12 border-b border-line" aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {displayedLines.length === 0 && (
              <tr><td colSpan={metadataHeaders.length + 14} className="px-6 py-12 text-center text-sm text-ink-soft">{emptyLabel}</td></tr>
            )}
            {displayedLines.map((line, rowIndex) => {
              const key = groupKey?.(line);
              const nextKey = displayedLines[rowIndex + 1] ? groupKey?.(displayedLines[rowIndex + 1]) : undefined;
              return (
                <Fragment key={line.id}>
                  <tr className="border-b border-line/70 hover:bg-soft/60">
                    {renderMetadata(
                      line,
                      (field, value) => commitMeta(line.id, field, value),
                      !editable,
                    )}
                    {MONTH_KEYS.map((month, monthIndex) => (
                      <td key={month} className="px-1 py-1">
                        <MoneyInput
                          value={line[month]}
                          disabled={!editable}
                          rowIndex={rowIndex}
                          monthIndex={monthIndex}
                          onCommit={(value) => commitMonth(line.id, month, value)}
                          onPaste={(event) => pasteBlock(event, rowIndex, monthIndex)}
                        />
                      </td>
                    ))}
                    <td className="cell-num border-l border-line bg-soft/50 px-3 py-2 text-sm font-semibold text-ink">
                      {formatCell(lineTotal(line))}
                    </td>
                    <td className="px-2 text-center">
                      {editable && (
                        <button
                          type="button"
                          aria-label="Eliminar línea"
                          title="Eliminar línea"
                          onClick={() => {
                            if (!window.confirm("¿Eliminar esta línea? Esta acción no se puede deshacer.")) return;
                            const previous = lines;
                            setLines((current) => current.filter((item) => item.id !== line.id));
                            void run(() => deleteLine(line.id), () => setLines(previous));
                          }}
                          className="rounded p-1.5 text-ink-soft hover:bg-danger-bg hover:text-danger"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                  {key && key !== nextKey && (
                    <tr className="border-b border-line bg-lavender-bg/50 text-xs font-semibold text-brand-dark">
                      <td colSpan={metadataHeaders.length} className="px-3 py-2">Subtotal {groupLabel?.(line) ?? key}</td>
                      {MONTH_KEYS.map((month) => (
                        <td key={month} className="cell-num px-3 py-2">{formatCell(categoryTotals(key)[month])}</td>
                      ))}
                      <td className="cell-num border-l border-line px-3 py-2">{formatCell(lineTotal(categoryTotals(key)))}</td>
                      <td />
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-brand-dark text-white">
            <tr>
              <th colSpan={metadataHeaders.length} className="px-3 py-3 text-sm">Total anual</th>
              {MONTH_KEYS.map((key) => <td key={key} className="cell-num px-3 py-3 text-sm font-semibold">{formatCell(totals[key])}</td>)}
              <td className="cell-num border-l border-white/20 px-3 py-3 text-sm font-bold">{formatCell(grandTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && (
        <div className="border-t border-line p-4">
          <button
            type="button"
            onClick={() => startTransition(() => void run(() => addLine(budgetId)))}
            className="rounded-lg border border-brand px-4 py-2 text-sm font-semibold text-brand transition hover:bg-lavender-bg"
          >
            + Agregar línea
          </button>
        </div>
      )}
    </section>
  );
}
