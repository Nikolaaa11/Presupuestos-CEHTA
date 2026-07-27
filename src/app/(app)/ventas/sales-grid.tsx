"use client";

import { useCallback } from "react";
import { AmountGrid } from "@/components/budget-grid/amount-grid";
import type { GridLine, InitiativeOption } from "@/components/budget-grid/types";
import type { CurrencyCode } from "@/lib/money";
import {
  addSalesLine,
  bulkUpdateSalesMonths,
  deleteSalesLine,
  updateSalesLineMeta,
  updateSalesLineMonths,
} from "./actions";

type SalesLine = GridLine & {
  client: string;
  saleType: "CONTRATO" | "PROYECCION_PUBLICO" | "RECURRENTE";
  channel: string;
  capexItemId: string | null;
};

const SALE_TYPES = [
  { value: "CONTRATO", label: "Contrato" },
  { value: "PROYECCION_PUBLICO", label: "Proyección público" },
  { value: "RECURRENTE", label: "Recurrente" },
] as const;

const TYPE_STYLE: Record<SalesLine["saleType"], string> = {
  CONTRATO: "bg-ok-bg text-ok",
  PROYECCION_PUBLICO: "bg-warn-bg text-warn",
  RECURRENTE: "bg-lavender-bg text-brand",
};

const METADATA_HEADERS = ["Cliente", "Tipo", "Canal", "Iniciativa"];

export function SalesGrid({
  budgetId,
  lines,
  initiatives,
  editable,
  currency,
}: {
  budgetId: string;
  lines: SalesLine[];
  initiatives: InitiativeOption[];
  editable: boolean;
  currency: CurrencyCode;
}) {
  // Identidad estable: si esta función se recreara en cada render, la
  // memoización de las filas de la grilla no serviría de nada.
  const renderMetadata = useCallback(
    (
      line: SalesLine,
      rowIndex: number,
      update: <K extends keyof SalesLine>(key: K, value: SalesLine[K]) => void,
      disabled: boolean,
    ) => (
      <>
        <td className="border-r border-line px-2 py-1">
          <input
            data-meta-row={rowIndex}
            defaultValue={line.client}
            disabled={disabled}
            onBlur={(event) => {
              if (event.target.value !== line.client) update("client", event.target.value);
            }}
            className="h-9 w-48 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
          />
        </td>
        <td className="border-r border-line px-2 py-1">
          <select
            value={line.saleType}
            disabled={disabled}
            onChange={(event) => update("saleType", event.target.value as SalesLine["saleType"])}
            className={`h-9 w-44 rounded-lg border-0 px-2 text-xs font-semibold outline-none ${TYPE_STYLE[line.saleType]}`}
          >
            {SALE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </td>
        <td className="border-r border-line px-2 py-1">
          <input
            defaultValue={line.channel}
            disabled={disabled}
            placeholder="Canal de venta"
            onBlur={(event) => {
              if (event.target.value !== line.channel) update("channel", event.target.value);
            }}
            className="h-9 w-40 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
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
    [initiatives],
  );

  return (
    <AmountGrid
      budgetId={budgetId}
      lines={lines}
      editable={editable}
      currency={currency}
      metadataHeaders={METADATA_HEADERS}
      emptyLabel="Aún no hay líneas de venta."
      addLine={addSalesLine}
      deleteLine={deleteSalesLine}
      updateMeta={updateSalesLineMeta}
      updateMonths={updateSalesLineMonths}
      bulkUpdate={bulkUpdateSalesMonths}
      renderMetadata={renderMetadata}
    />
  );
}
