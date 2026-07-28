import type { MonthKey, RealMonthKey } from "@/lib/money";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type MonthPatch = Partial<Record<MonthKey, string>>;

export type GridLine = {
  id: string;
} & Record<MonthKey, string> &
  Partial<Record<RealMonthKey, string>>;

export type InitiativeOption = {
  id: string;
  label: string;
};

/** Qué serie muestra la grilla. Solo "presupuesto" es editable. */
export type GridView = "presupuesto" | "real" | "variacion";
