"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmountGrid } from "@/components/budget-grid/amount-grid";
import type { GridLine, InitiativeOption } from "@/components/budget-grid/types";
import { marcarGastoPagado } from "@/app/(app)/budget-actions";
import { formatMoney, type CurrencyCode } from "@/lib/money";
import {
  addExpenseLine,
  bulkUpdateExpenseMonths,
  deleteExpenseLine,
  updateExpenseLineMeta,
  updateExpenseLineMonths,
} from "./actions";

type ExpenseLine = GridLine & {
  categoryId: string;
  item: string;
  capexItemId: string | null;
  paid: boolean;
  paidAt: string | null;
};

type SugerenciaPago = {
  lineId: string;
  referencia: string;
  monto: string;
  fecha: string | null;
};

const METADATA_HEADERS = ["Categoría", "Ítem", "Iniciativa", "Pagado"];

export function ExpenseGrid({
  budgetId,
  lines,
  categories,
  initiatives,
  editable,
  currency,
  sugerencias,
}: {
  budgetId: string;
  lines: ExpenseLine[];
  categories: { id: string; name: string }[];
  initiatives: InitiativeOption[];
  editable: boolean;
  currency: CurrencyCode;
  sugerencias: SugerenciaPago[];
}) {
  // Estado optimista de "pagado" con RE-SINCRONIZACIÓN cuando el servidor
  // revalida (mismo patrón que AmountGrid usa para las líneas): al llegar una
  // identidad nueva de `lines`, mandan las props frescas — se conservan solo
  // las entradas con request en vuelo, para no pisar un toggle a medio camino.
  // Sin esto, un pago marcado por otra sesión quedaba invisible para siempre.
  const [paymentState, setPaymentState] = useState(() =>
    new Map(lines.map((line) => [line.id, { paid: line.paid, paidAt: line.paidAt }])),
  );
  const [pendingPayments, setPendingPayments] = useState(() => new Set<string>());
  const pendingRef = useRef(pendingPayments);
  useEffect(() => {
    pendingRef.current = pendingPayments;
  }, [pendingPayments]);

  const [sourceLines, setSourceLines] = useState(lines);
  if (lines !== sourceLines) {
    setSourceLines(lines);
    const enVueloAhora = pendingPayments;
    setPaymentState((current) => {
      const next = new Map(lines.map((line) => [line.id, { paid: line.paid, paidAt: line.paidAt }]));
      for (const id of enVueloAhora) {
        const enVuelo = current.get(id);
        if (enVuelo) next.set(id, enVuelo);
      }
      return next;
    });
  }

  const suggestionByLine = useMemo(
    () => new Map(sugerencias.map((suggestion) => [suggestion.lineId, suggestion])),
    [sugerencias],
  );

  // Estable (deps vacías): lee lo mutable vía updaters funcionales y ref, así
  // no se recrea en cada toggle — renderMetadata depende de él y AmountGrid
  // memoiza las filas contando con callbacks estables.
  const setPaid = useCallback(async (line: ExpenseLine, paid: boolean) => {
    if (pendingRef.current.has(line.id)) return;
    let previous = { paid: line.paid, paidAt: line.paidAt };
    const optimistic = { paid, paidAt: paid ? new Date().toISOString() : null };
    setPaymentState((current) => {
      previous = current.get(line.id) ?? previous;
      return new Map(current).set(line.id, optimistic);
    });
    setPendingPayments((current) => new Set(current).add(line.id));

    try {
      const result = await marcarGastoPagado(line.id, paid);
      if (!result.ok) {
        setPaymentState((current) => new Map(current).set(line.id, previous));
        window.alert(result.error);
      }
    } catch {
      setPaymentState((current) => new Map(current).set(line.id, previous));
      window.alert("No fue posible guardar el pago. Revisá tu conexión e intentalo de nuevo.");
    } finally {
      setPendingPayments((current) => {
        const next = new Set(current);
        next.delete(line.id);
        return next;
      });
    }
  }, []);

  // Búsqueda por Map: antes cada fila hacía un find lineal sobre el catálogo.
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const groupKey = useCallback((line: ExpenseLine) => line.categoryId, []);
  const groupLabel = useCallback(
    (line: ExpenseLine) => categoryNames.get(line.categoryId) ?? "Sin categoría",
    [categoryNames],
  );

  const renderMetadata = useCallback(
    (
      line: ExpenseLine,
      rowIndex: number,
      update: <K extends keyof ExpenseLine>(key: K, value: ExpenseLine[K]) => void,
      disabled: boolean,
    ) => (
      <>
        <td className="border-r border-line px-2 py-1">
          <select
            value={line.categoryId}
            disabled={disabled}
            onChange={(event) => update("categoryId", event.target.value)}
            className="h-9 w-48 rounded border border-transparent bg-transparent px-2 text-sm font-medium outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </td>
        <td className="border-r border-line px-2 py-1">
          <input
            data-meta-row={rowIndex}
            defaultValue={line.item}
            disabled={disabled}
            onBlur={(event) => {
              if (event.target.value !== line.item) update("item", event.target.value);
            }}
            className="h-9 w-56 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
          />
        </td>
        <td className="border-r border-line px-2 py-1">
          <select
            value={line.capexItemId ?? ""}
            disabled={disabled}
            onChange={(event) => update("capexItemId", event.target.value || null)}
            className="h-9 w-44 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
          >
            <option value="">—</option>
            {initiatives.map((initiative) => (
              <option key={initiative.id} value={initiative.id}>{initiative.label}</option>
            ))}
          </select>
        </td>
        <td className="min-w-48 border-r border-line px-3 py-2 text-center">
          {(() => {
            const payment = paymentState.get(line.id) ?? { paid: line.paid, paidAt: line.paidAt };
            const suggestion = suggestionByLine.get(line.id);
            const pending = pendingPayments.has(line.id);
            const title = payment.paid && payment.paidAt
              ? `Pagado el ${new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(payment.paidAt))}`
              : undefined;

            return (
              <div className="flex flex-col items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={payment.paid}
                  disabled={pending}
                  title={title}
                  aria-label={`Marcar ${line.item} como ${payment.paid ? "no pagado" : "pagado"}`}
                  onChange={(event) => void setPaid(line, event.target.checked)}
                  className="size-4 accent-ok disabled:opacity-50"
                />
                {!payment.paid && suggestion && (
                  <div className="rounded-md border border-ok/30 bg-ok-bg px-2 py-1 text-left text-[11px] leading-tight text-ok">
                    <span>Calza con {suggestion.referencia} · {formatMoney(suggestion.monto, currency)}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => void setPaid(line, true)}
                      className="ml-1 font-semibold underline underline-offset-2 disabled:opacity-60"
                    >
                      Confirmar
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </td>
      </>
    ),
    [categories, currency, initiatives, paymentState, pendingPayments, setPaid, suggestionByLine],
  );

  return (
    <AmountGrid
      budgetId={budgetId}
      lines={lines}
      editable={editable}
      currency={currency}
      metadataHeaders={METADATA_HEADERS}
      emptyLabel="Aún no hay líneas de gasto."
      addLine={addExpenseLine}
      deleteLine={deleteExpenseLine}
      updateMeta={updateExpenseLineMeta}
      updateMonths={updateExpenseLineMonths}
      bulkUpdate={bulkUpdateExpenseMonths}
      groupKey={groupKey}
      groupLabel={groupLabel}
      renderMetadata={renderMetadata}
    />
  );
}
