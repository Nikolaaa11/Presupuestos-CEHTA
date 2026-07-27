"use client";

import { AmountGrid } from "@/components/budget-grid/amount-grid";
import type { GridLine, InitiativeOption } from "@/components/budget-grid/types";
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

export function SalesGrid({
  budgetId,
  lines,
  initiatives,
  editable,
}: {
  budgetId: string;
  lines: SalesLine[];
  initiatives: InitiativeOption[];
  editable: boolean;
}) {
  return (
    <AmountGrid
      budgetId={budgetId}
      lines={lines}
      editable={editable}
      metadataHeaders={["Cliente", "Tipo", "Canal", "Iniciativa"]}
      emptyLabel="Aún no hay líneas de venta."
      addLine={addSalesLine}
      deleteLine={deleteSalesLine}
      updateMeta={updateSalesLineMeta}
      updateMonths={updateSalesLineMonths}
      bulkUpdate={bulkUpdateSalesMonths}
      renderMetadata={(line, update, disabled) => (
        <>
          <td className="border-r border-line px-2 py-1">
            <input
              data-meta-row={lines.findIndex((item) => item.id === line.id)}
              defaultValue={line.client}
              disabled={disabled}
              onBlur={(event) => {
                if (event.target.value !== line.client) void update("client", event.target.value);
              }}
              className="h-9 w-48 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
            />
          </td>
          <td className="border-r border-line px-2 py-1">
            <select
              value={line.saleType}
              disabled={disabled}
              onChange={(event) => void update("saleType", event.target.value as SalesLine["saleType"])}
              className={`h-9 w-44 rounded-lg border-0 px-2 text-xs font-semibold outline-none ${TYPE_STYLE[line.saleType]}`}
            >
              {SALE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </td>
          <td className="border-r border-line px-2 py-1">
            <input
              defaultValue={line.channel}
              disabled={disabled}
              placeholder="Canal de venta"
              onBlur={(event) => {
                if (event.target.value !== line.channel) void update("channel", event.target.value);
              }}
              className="h-9 w-40 rounded border border-transparent bg-transparent px-2 text-sm outline-none enabled:hover:border-line enabled:focus:border-brand enabled:focus:bg-white"
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
