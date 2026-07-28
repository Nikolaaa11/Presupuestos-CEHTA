"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Decimal from "decimal.js";
import {
  formatCell,
  formatMoney,
  lineTotal,
  MONTH_KEYS,
  MONTH_LABELS,
  monthlyTotals,
  type CurrencyCode,
  realKeyOf,
  type MonthKey,
} from "@/lib/money";
import type { ActionResult, GridLine, GridView, MonthPatch } from "./types";

/**
 * Grilla de montos mes a mes.
 *
 * Notas de rendimiento (medidas, no supuestas):
 *  - Cada fila es un componente memoizado: al confirmar una celda solo se
 *    re-renderiza esa fila, no las 12 celdas × N filas de toda la tabla.
 *    Para que la memoización sirva, TODOS los callbacks que bajan a la fila son
 *    estables (no dependen de `lines`): el valor anterior para el rollback lo
 *    aporta la propia fila, que ya lo tiene.
 *  - Los subtotales por categoría se calculan en UNA pasada memoizada por
 *    cambio de datos, no con un filter+suma por cada fila de subtotal en cada
 *    render.
 *  - El índice de fila viaja como prop en vez de resolverse con findIndex
 *    dentro del map (eso era O(n²)).
 *  - El total anual se muestra acá y no en el servidor: así queda vivo sin
 *    pagar una revalidación de ruta por cada celda editada.
 */

type Props<T extends GridLine> = {
  budgetId: string;
  lines: T[];
  editable: boolean;
  currency: CurrencyCode;
  metadataHeaders: string[];
  renderMetadata: (
    line: T,
    rowIndex: number,
    update: <K extends keyof T>(key: K, value: T[K]) => void,
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

/**
 * Valor de una celda según la serie visible.
 *  - presupuesto: m01-m12 (editable)
 *  - real:        r01-r12 (ejecutado, solo lectura)
 *  - variacion:   real − presupuesto (solo lectura)
 */
export function cellValueFor(line: GridLine, key: MonthKey, view: GridView): string {
  const budget = line[key] ?? "0";
  if (view === "presupuesto") return budget;
  const real = line[realKeyOf(key)] ?? "0";
  if (view === "real") return real;
  return new Decimal(real).minus(new Decimal(budget)).toString();
}

/** ¿La planilla trae ejecución real cargada? */
function hasRealData(lines: GridLine[]): boolean {
  return lines.some((line) => MONTH_KEYS.some((k) => Number(line[realKeyOf(k)] ?? 0) !== 0));
}

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

// ─────────────────────────────── Celda ───────────────────────────────

const MoneyInput = memo(function MoneyInput({
  value,
  disabled,
  negative = false,
  rowIndex,
  monthIndex,
  onCommit,
  onPaste,
}: {
  value: string;
  disabled: boolean;
  negative?: boolean;
  rowIndex: number;
  monthIndex: number;
  onCommit: (next: string, previous: string) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, monthIndex: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    const normalized = normalizeAmount(draft);
    if (normalized === null) {
      setDraft(value);
      return;
    }
    setDraft(normalized);
    if (normalized !== value) onCommit(normalized, value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      document
        .querySelector<HTMLInputElement>(`[data-money-cell="${rowIndex + 1}-${monthIndex}"]`)
        ?.focus();
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
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onPaste={(event) => onPaste(event, rowIndex, monthIndex)}
      className={`cell-num h-9 w-24 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white disabled:cursor-default ${
        negative ? "text-danger" : "text-ink"
      }`}
    />
  );
});

// ─────────────────────────────── Fila ───────────────────────────────

type RowProps<T extends GridLine> = {
  line: T;
  rowIndex: number;
  editable: boolean;
  view: GridView;
  renderMetadata: Props<T>["renderMetadata"];
  onCommitMonth: (lineId: string, key: MonthKey, next: string, previous: string) => void;
  onCommitMeta: <K extends keyof T>(lineId: string, key: K, value: T[K], previous: T[K]) => void;
  onDelete: (line: T) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>, rowIndex: number, monthIndex: number) => void;
};

function GridRowInner<T extends GridLine>({
  line,
  rowIndex,
  editable,
  view,
  renderMetadata,
  onCommitMonth,
  onCommitMeta,
  onDelete,
  onPaste,
}: RowProps<T>) {
  // Total de la fila en la serie visible: se recalcula solo cuando cambia ESTA
  // fila o la vista (memo del componente).
  const total = MONTH_KEYS.reduce(
    (acc, k) => acc.plus(new Decimal(cellValueFor(line, k, view) || 0)),
    new Decimal(0),
  );
  const editableCells = editable && view === "presupuesto";

  const updateMeta = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => onCommitMeta(line.id, key, value, line[key]),
    [line, onCommitMeta],
  );

  return (
    <tr className="border-b border-line/70 hover:bg-soft/60">
      {renderMetadata(line, rowIndex, updateMeta, !editable)}
      {MONTH_KEYS.map((month, monthIndex) => {
        const value = cellValueFor(line, month, view);
        const negative = view === "variacion" && Number(value) < 0;
        return (
          <td key={month} className="px-1 py-1">
            <MoneyInput
              value={value}
              disabled={!editableCells}
              negative={negative}
              rowIndex={rowIndex}
              monthIndex={monthIndex}
              onCommit={(next, previous) => onCommitMonth(line.id, month, next, previous)}
              onPaste={onPaste}
            />
          </td>
        );
      })}
      <td
        className={`cell-num border-l border-line bg-soft/50 px-3 py-2 text-sm font-semibold ${
          view === "variacion" && total.isNegative() ? "text-danger" : "text-ink"
        }`}
      >
        {formatCell(total)}
      </td>
      <td className="px-2 text-center">
        {editableCells && (
          <button
            type="button"
            aria-label={`Eliminar línea ${rowIndex + 1}`}
            title="Eliminar línea"
            onClick={() => onDelete(line)}
            className="rounded p-1.5 text-ink-soft hover:bg-danger-bg hover:text-danger"
          >
            ×
          </button>
        )}
      </td>
    </tr>
  );
}

const GridRow = memo(GridRowInner) as typeof GridRowInner;

// ─────────────────────────────── Grilla ───────────────────────────────

export function AmountGrid<T extends GridLine>({
  budgetId,
  lines: initialLines,
  editable,
  currency,
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
  const [view, setView] = useState<GridView>("presupuesto");
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

  // Espejo de `lines` para los handlers que necesitan el estado actual sin
  // depender de él (así siguen siendo estables y la memoización de filas vive).
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    if (initialLines.length > previousLength.current) {
      document.querySelector<HTMLInputElement>(`[data-meta-row="${initialLines.length - 1}"]`)?.focus();
    }
    previousLength.current = initialLines.length;
  }, [initialLines.length]);

  const run = useCallback(async (action: () => Promise<ActionResult>, rollback?: () => void) => {
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
  }, []);

  const patchLine = useCallback((lineId: string, patch: Partial<T>) => {
    setLines((current) => current.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  }, []);

  const onCommitMonth = useCallback(
    (lineId: string, key: MonthKey, next: string, previous: string) => {
      patchLine(lineId, { [key]: next } as unknown as Partial<T>);
      void run(
        () => updateMonths(lineId, { [key]: next }),
        () => patchLine(lineId, { [key]: previous } as unknown as Partial<T>),
      );
    },
    [patchLine, run, updateMonths],
  );

  const onCommitMeta = useCallback(
    <K extends keyof T>(lineId: string, key: K, value: T[K], previous: T[K]) => {
      patchLine(lineId, { [key]: value } as unknown as Partial<T>);
      void run(
        () => updateMeta(lineId, { [key]: value } as Record<string, unknown>),
        () => patchLine(lineId, { [key]: previous } as unknown as Partial<T>),
      );
    },
    [patchLine, run, updateMeta],
  );

  const onDelete = useCallback(
    (line: T) => {
      if (!window.confirm("¿Eliminar esta línea? Esta acción no se puede deshacer.")) return;
      const snapshot = linesRef.current;
      setLines((current) => current.filter((item) => item.id !== line.id));
      void run(() => deleteLine(line.id), () => setLines(snapshot));
    },
    [deleteLine, run],
  );

  // Orden de presentación: agrupado por categoría cuando corresponde.
  const displayedLines = useMemo(() => {
    if (!groupKey) return lines;
    return [...lines].sort((left, right) => groupKey(left).localeCompare(groupKey(right)));
  }, [groupKey, lines]);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>, anchorRow: number, anchorMonth: number) => {
      if (!editable) return;
      const rows = event.clipboardData
        .getData("text")
        .replace(/\r/g, "")
        .split("\n")
        .filter((row) => row !== "");
      if (rows.length === 0) return;
      event.preventDefault();

      const current = linesRef.current;
      const ordered = groupKey
        ? [...current].sort((l, r) => groupKey(l).localeCompare(groupKey(r)))
        : current;

      const updates = new Map<string, MonthPatch>();
      const patched = new Map<string, Partial<T>>();
      rows.forEach((row, rowOffset) => {
        const target = ordered[anchorRow + rowOffset];
        if (!target) return;
        row.split("\t").forEach((cell, colOffset) => {
          const key = MONTH_KEYS[anchorMonth + colOffset];
          const value = normalizeAmount(cell);
          if (!key || value === null) return;
          updates.set(target.id, { ...(updates.get(target.id) ?? {}), [key]: value });
          patched.set(target.id, { ...(patched.get(target.id) ?? {}), [key]: value } as Partial<T>);
        });
      });
      if (updates.size === 0) return;

      const snapshot = current;
      setLines((prev) => prev.map((line) => (patched.has(line.id) ? { ...line, ...patched.get(line.id)! } : line)));
      void run(
        () => bulkUpdate(budgetId, [...updates].map(([lineId, patch]) => ({ lineId, patch }))),
        () => setLines(snapshot),
      );
    },
    [budgetId, bulkUpdate, editable, groupKey, run],
  );

  const conReal = useMemo(() => hasRealData(lines), [lines]);
  const activeView: GridView = conReal ? view : "presupuesto";

  // Totales del pie y total anual, en la serie visible.
  const totals = useMemo(() => {
    if (activeView === "presupuesto") return monthlyTotals(lines);
    const acc = Object.fromEntries(MONTH_KEYS.map((k) => [k, new Decimal(0)])) as Record<MonthKey, Decimal>;
    for (const line of lines) {
      for (const k of MONTH_KEYS) acc[k] = acc[k].plus(new Decimal(cellValueFor(line, k, activeView) || 0));
    }
    return acc;
  }, [lines, activeView]);
  const grandTotal = useMemo(() => lineTotal(totals), [totals]);

  // Subtotales por categoría: UNA pasada agrupando, en vez de filtrar y sumar
  // de nuevo por cada fila de subtotal en cada render.
  const groupTotals = useMemo(() => {
    if (!groupKey) return null;
    const byGroup = new Map<string, T[]>();
    for (const line of lines) {
      const key = groupKey(line);
      const bucket = byGroup.get(key);
      if (bucket) bucket.push(line);
      else byGroup.set(key, [line]);
    }
    return new Map(
      [...byGroup].map(([key, groupLines]) => {
        const monthly =
          activeView === "presupuesto"
            ? monthlyTotals(groupLines)
            : (Object.fromEntries(
                MONTH_KEYS.map((k) => [
                  k,
                  groupLines.reduce((acc, l) => acc.plus(new Decimal(cellValueFor(l, k, activeView) || 0)), new Decimal(0)),
                ]),
              ) as Record<MonthKey, Decimal>);
        return [key, { monthly, total: lineTotal(monthly) }];
      }),
    );
  }, [groupKey, lines, activeView]);

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2">
        <p className="text-xs text-ink-soft">
          {pendingCount > 0 ? (
            "Guardando…"
          ) : message ? (
            <span className="text-danger">Error: {message}</span>
          ) : (
            "Guardado ✓"
          )}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {conReal ? (
            <div className="flex items-center gap-1" role="group" aria-label="Serie a mostrar">
              {(["presupuesto", "real", "variacion"] as GridView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={activeView === v}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                    activeView === v ? "bg-brand text-white" : "border border-line text-ink-soft hover:bg-soft"
                  }`}
                >
                  {v === "variacion" ? "variación" : v}
                </button>
              ))}
            </div>
          ) : (
            <p className="hidden text-xs text-ink-soft sm:block">
              Puedes pegar bloques desde Excel en cualquier mes.
            </p>
          )}
          <p className="text-sm">
            <span className="text-xs text-ink-soft">
              {activeView === "presupuesto" ? "Total anual " : activeView === "real" ? "Total ejecutado " : "Variación anual "}
            </span>
            <strong className={activeView === "variacion" && grandTotal.isNegative() ? "text-danger" : "text-ink"}>
              {formatMoney(grandTotal, currency)}
            </strong>
          </p>
        </div>
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
              <tr>
                <td colSpan={metadataHeaders.length + 14} className="px-6 py-12 text-center text-sm text-ink-soft">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {displayedLines.map((line, rowIndex) => {
              const key = groupKey?.(line);
              const nextKey = displayedLines[rowIndex + 1] ? groupKey?.(displayedLines[rowIndex + 1]) : undefined;
              const subtotal = key ? groupTotals?.get(key) : undefined;
              return (
                <Fragment key={line.id}>
                  <GridRow
                    line={line}
                    rowIndex={rowIndex}
                    editable={editable}
                    view={activeView}
                    renderMetadata={renderMetadata}
                    onCommitMonth={onCommitMonth}
                    onCommitMeta={onCommitMeta}
                    onDelete={onDelete}
                    onPaste={onPaste}
                  />
                  {key && key !== nextKey && subtotal && (
                    <tr className="border-b border-line bg-lavender-bg/50 text-xs font-semibold text-brand-dark">
                      <td colSpan={metadataHeaders.length} className="px-3 py-2">
                        Subtotal {groupLabel?.(line) ?? key}
                      </td>
                      {MONTH_KEYS.map((month) => (
                        <td key={month} className="cell-num px-3 py-2">{formatCell(subtotal.monthly[month])}</td>
                      ))}
                      <td className="cell-num border-l border-line px-3 py-2">{formatCell(subtotal.total)}</td>
                      <td />
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="bg-brand-dark text-white">
            <tr>
              <th colSpan={metadataHeaders.length} className="px-3 py-3 text-sm">
                {activeView === "presupuesto" ? "Total anual" : activeView === "real" ? "Total ejecutado" : "Variación (real − presupuesto)"}
              </th>
              {MONTH_KEYS.map((key) => (
                <td key={key} className="cell-num px-3 py-3 text-sm font-semibold">{formatCell(totals[key])}</td>
              ))}
              <td className="cell-num border-l border-white/20 px-3 py-3 text-sm font-bold">{formatCell(grandTotal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && activeView === "presupuesto" && (
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
