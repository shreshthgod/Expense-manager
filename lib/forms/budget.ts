import type { BudgetStatus } from "@/server/analytics/budget-status";

export interface BudgetFormState {
  name: string;
  amount: string;
  period: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
  startDate: string;
  endDate: string;
  /** "" = all spending; otherwise a database category id. */
  categoryId: string;
  rolloverMode: "NONE" | "POSITIVE_ONLY" | "FULL";
}

export function emptyBudgetForm(startDate: string): BudgetFormState {
  return { name: "", amount: "", period: "MONTHLY", startDate, endDate: "", categoryId: "", rolloverMode: "NONE" };
}

/** Editing keeps the current category selected (v1 B10 cleared it). */
export function budgetFormFromStatus(b: BudgetStatus): BudgetFormState {
  return {
    name: b.name,
    amount: String(b.amount),
    period: b.period,
    startDate: b.startDate,
    endDate: b.endDate ?? "",
    categoryId: b.categoryId ?? "",
    rolloverMode: b.rolloverMode,
  };
}

export function buildBudgetCreateBody(s: BudgetFormState) {
  return {
    name: s.name.trim(),
    amount: s.amount.replace(/,/g, "").trim(),
    period: s.period,
    startDate: s.startDate,
    endDate: s.endDate || null,
    categoryId: s.categoryId || null,
    // Rollover only makes sense for repeating cycles.
    rolloverMode: s.period === "CUSTOM" ? "NONE" : s.rolloverMode,
  };
}

export function buildBudgetUpdateBody(s: BudgetFormState, version: number) {
  return { ...buildBudgetCreateBody(s), version };
}
