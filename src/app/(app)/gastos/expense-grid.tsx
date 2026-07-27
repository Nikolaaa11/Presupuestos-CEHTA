"use client";

import { AmountGrid } from "@/components/budget-grid/amount-grid";
import type { GridLine, InitiativeOption } from "@/components/budget-grid/types";
import {
  addExpenseLine,
  bulkUpdateExpenseMonths,
  deleteExpenseLine,
  updateExpenseLineMeta,
  updateExpenseLineMonths,
} from "./actions";

type ExpenseLine = GridLine & {
  categoryId: string;
  categoryName: string;
  item: string;
  capexItemId: string | null;
};

export function ExpenseGrid({
  budgetId,
  lines,
  categories,
  initiatives,
  editable,
}: {
  budgetId: string;
  lines: ExpenseLine[];
  categories: { id: string; name: string }[];
  initiatives: InitiativeOption[];
  editable: boolean;
}) {
  const categoryName = (id: string) => categories.find((category) => category.id === id)?.name ?? "Sin categoría";

  return (
    <AmountGrid
      budgetId={budgetId}
      lines={lines}
      editable={editable}
      metadataHeaders={["Categoría", "Ítem", "Iniciativa"]}
      emptyLabel="Aún no hay líneas de gasto."
      addLine={addExpenseLine}
      deleteLine={deleteExpenseLine}
      updateMeta={updateExpenseLineMeta}
      updateMonths={updateExpenseLineMonths}
      bulkUpdate={bulkUpdateExpenseMonths}
      groupKey={(line) => line.categoryId}
      groupLabel={(line) => categoryName(line.categoryId)}
      renderMetadata={(line, update, disabled) => (
        <>
          <td className="border-r border-line px-2 py-1">
            <select
              value={line.categoryId}
              disabled={disabled}
              onChange={(event) => void update("categoryId", event.target.value)}
              className="h-9 w-48 rounded border border-transparent bg-transparent px-2 text-sm font-medium outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
            >
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </td>
          <td className="border-r border-line px-2 py-1">
            <input
              data-meta-row={lines.findIndex((item) => item.id === line.id)}
              defaultValue={line.item}
              disabled={disabled}
              onBlur={(event) => {
                if (event.target.value !== line.item) void update("item", event.target.value);
              }}
              className="h-9 w-56 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
            />
          </td>
          <td className="border-r border-line px-2 py-1">
            <select
              value={line.capexItemId ?? ""}
              disabled={disabled}
              onChange={(event) => void update("capexItemId", event.target.value || null)}
              className="h-9 w-44 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
            >
              <option value="">—</option>
              {initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.label}</option>)}
            </select>
          </td>
        </>
      )}
    />
  );
}
