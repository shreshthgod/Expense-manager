import { lastDayOf } from "@/lib/dates/date-only";
import { compareTotals, totalsForWindows, type PeriodComparison, type PeriodTotals } from "@/server/analytics/definitions";
import type { ResolvedPeriod } from "@/server/analytics/ranges";

export interface FinancialSummary {
  period: { label: string; start: string; end: string; lastDay: string };
  previousPeriod: { start: string; end: string; lastDay: string };
  current: PeriodTotals;
  previous: PeriodTotals;
  changes: PeriodComparison;
}

export async function getFinancialSummary(userId: string, period: ResolvedPeriod): Promise<FinancialSummary> {
  const totals = await totalsForWindows(userId, [
    { key: "current", range: period.range },
    { key: "previous", range: period.previous },
  ]);
  const current = totals.get("current")!;
  const previous = totals.get("previous")!;
  return {
    period: { label: period.label, ...period.range, lastDay: lastDayOf(period.range) },
    previousPeriod: { ...period.previous, lastDay: lastDayOf(period.previous) },
    current,
    previous,
    changes: compareTotals(current, previous),
  };
}
