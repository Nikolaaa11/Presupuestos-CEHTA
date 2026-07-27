"use client";

import { useCallback, useMemo } from "react";
import { AmountGrid } from "@/components/budget-grid/amount-grid";
import type { GridLine, InitiativeOption } from "@/components/budget-grid/types";
import type { CurrencyCode } from "@/lib/money";
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
};

const METADATA_HEADERS = ["Categoría", "Ítem", "Iniciativa"];

export function ExpenseGrid({
  budgetId,
  lines,
  categories,
  initiatives,
  editable,
  currency,
}: {
  budgetId: string;
  lines: ExpenseLine[];
  categories: { id: string; name: string }[];
  initiatives: InitiativeOption[];
  editable: boolean;
  currency: CurrencyCode;
}) {
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
      </>
    ),
    [categories, initiatives],
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
