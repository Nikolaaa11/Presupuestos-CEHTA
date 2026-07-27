import type { MonthKey } from "@/lib/money";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type MonthPatch = Partial<Record<MonthKey, string>>;

export type GridLine = {
  id: string;
} & Record<MonthKey, string>;

export type InitiativeOption = {
  id: string;
  label: string;
};
