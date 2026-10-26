import { addDays, diffDays, financialMonthOf, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";
import { totalsForWindows } from "@/server/analytics/definitions";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { trailingMonths, type PeriodSettings } from "@/server/analytics/ranges";

export interface ForecastResult {
  /** Averages over the trailing complete months actually present (up to 4). */
  expectedMonthlyExpenses: number;
  expectedMonthlyIncome: number;
  expectedMonthlySurplus: number;
  monthToDate: { start: ISODate; end: ISODate; spent: number; income: number; daysElapsed: number; daysInMonth: number };
  /** Straight-line projection of this month's net spending (estimate, not a promise). */
  projectedMonthEndExpenses: number;
  projectedMonthEndSurplus: number;
  budgetsAtRisk: { id: string; name: string; utilization: number | null; projectedSpend: number; amount: number }[];
  dataQualityMonths: number;
  method: string;
}

/**
 * Deterministic spending forecast. The projection uses the month-to-date pace
 * once at least 3 days have elapsed, otherwise the trailing average. The AI
 * may narrate the result but never produces these numbers.
 */
export async function forecastSpending(userId: string, today: ISODate, settings: PeriodSettings): Promise<ForecastResult> {
  const current = financialMonthOf(today, settings.monthStartDay);
  const history = trailingMonths(addDays(current.start, -1), 4, settings);
  const windows = [
    ...history.map((range, i) => ({ key: `h${i}`, range })),
    { key: "mtd", range: { start: current.start, end: addDays(today, 1) } },
  ];
  const [totals, budgets] = await Promise.all([
    totalsForWindows(userId, windows),
    getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn }),
  ]);
  const complete = history.map((_, i) => totals.get(`h${i}`)!).filter((t) => t.transactionCount > 0);
  const n = complete.length;
  const avgExpense = n ? complete.reduce((a, t) => a + t.netSpending, 0) / n : 0;
  const avgIncome = n ? complete.reduce((a, t) => a + t.income, 0) / n : 0;
  const mtd = totals.get("mtd")!;
  const daysInMonth = diffDays(current.start, current.end);
  const daysElapsed = Math.min(daysInMonth, diffDays(current.start, today) + 1);
  const usePace = daysElapsed >= 3;
  const projected = usePace ? round2((mtd.netSpending / daysElapsed) * daysInMonth) : round2(avgExpense);
  const incomeBasis = Math.max(avgIncome, mtd.income);

  return {
    expectedMonthlyExpenses: round2(avgExpense),
    expectedMonthlyIncome: round2(avgIncome),
    expectedMonthlySurplus: round2(avgIncome - avgExpense),
    monthToDate: { ...current, spent: mtd.netSpending, income: mtd.income, daysElapsed, daysInMonth },
    projectedMonthEndExpenses: projected,
    projectedMonthEndSurplus: round2(incomeBasis - projected),
    budgetsAtRisk: budgets
      .filter((b) => b.cycle.state === "active" && (b.exceeded || b.projectedSpend > b.amount))
      .map((b) => ({ id: b.id, name: b.name, utilization: b.utilization, projectedSpend: b.projectedSpend, amount: b.amount })),
    dataQualityMonths: n,
    method: usePace
      ? `Month-to-date net spending (${daysElapsed} of ${daysInMonth} days) extended at the same daily pace.`
      : `Average of the last ${n} complete month(s) — too early in the month to use the current pace.`,
  };
}
