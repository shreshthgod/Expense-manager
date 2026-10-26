import { addDays, lastDayOf, minISO, previousRangeOf, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { formatMoney } from "@/lib/utils/format";
import { round2 } from "@/lib/utils/money";
import { compareTotals, totalsForRange, type PeriodComparison, type PeriodTotals } from "@/server/analytics/definitions";
import { getCategoryBreakdown, type CategoryAnalysis } from "@/server/analytics/categories";
import { getBudgetStatuses, type BudgetStatus } from "@/server/analytics/budget-status";
import { detectAnomaliesInRange, type Anomaly } from "@/server/analytics/detect";
import { calculateHealthScore, HEALTH_FORMULA_VERSION, type HealthScore } from "@/server/analytics/health-score";
import { getTopMerchants, type MerchantSpend } from "@/server/analytics/merchants";
import { getDailyTrend, getMonthlyTrend, getWeeklyTrend, type TrendPoint } from "@/server/analytics/trends";
import { getBalanceSummary, type BalanceSummary } from "@/server/services/account.service";
import { listGoals, type GoalStatus } from "@/server/services/goal.service";
import { listRecurring } from "@/server/services/recurring.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const REPORT_SCHEMA_VERSION = 2;

/**
 * The deterministic dataset behind a report. Every number a report (or its AI
 * narrative) shows comes from here. Generated once and stored as an immutable
 * snapshot; later data changes mark the snapshot stale instead of rewriting it.
 */
export interface ReportDataset {
  schemaVersion: number;
  formulaVersion: string;
  generatedAt: string;
  timezone: string;
  currency: string;
  period: { label: string; start: ISODate; end: ISODate; lastDay: ISODate };
  previousPeriod: { start: ISODate; end: ISODate; lastDay: ISODate };
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  changes: PeriodComparison;
  categories: CategoryAnalysis[];
  incomeSources: CategoryAnalysis[];
  trend: { granularity: "day" | "week" | "month"; points: TrendPoint[] };
  merchants: MerchantSpend[];
  budgets: BudgetStatus[];
  goals: GoalStatus[];
  recurring: { monthlyExpenseLoad: number; monthlyIncome: number; activeCount: number };
  anomalies: Anomaly[];
  /** Balances at generation time (not historical). */
  balancesAtGeneration: BalanceSummary;
  healthScore: HealthScore;
  dataAvailability: "low" | "medium" | "high";
}

export function availabilityOf(totals: PeriodTotals): ReportDataset["dataAvailability"] {
  if (totals.transactionCount < 10) return "low";
  if (totals.transactionCount < 30 || totals.income === 0) return "medium";
  return "high";
}

export async function buildReportDataset(userId: string, range: DateRange, label: string): Promise<ReportDataset> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const previous = previousRangeOf(range);
  const lengthDays = (Date.parse(range.end) - Date.parse(range.start)) / 86_400_000;
  const budgetRef = minISO(lastDayOf(range), today);
  const money = (n: number) => formatMoney(n, settings.currency);

  const trendPromise: Promise<{ granularity: "day" | "week" | "month"; points: TrendPoint[] }> =
    lengthDays <= 35
      ? getDailyTrend(userId, range).then((points) => ({ granularity: "day" as const, points }))
      : lengthDays <= 120
        ? getWeeklyTrend(userId, range, settings.weekStartsOn).then((points) => ({ granularity: "week" as const, points }))
        : getMonthlyTrend(userId, addDays(range.end, -1), Math.round(lengthDays / 30.4), { ...settings, monthStartDay: 1 }).then((points) => ({
            granularity: "month" as const,
            points,
          }));

  const [totals, previousTotals, categories, incomeSources, trend, merchants, budgets, goals, recurring, anomalies, balances, healthScore] =
    await Promise.all([
      totalsForRange(userId, range),
      totalsForRange(userId, previous),
      getCategoryBreakdown(userId, range, previous, "EXPENSE"),
      getCategoryBreakdown(userId, range, previous, "INCOME"),
      trendPromise,
      getTopMerchants(userId, range, previous, 10),
      getBudgetStatuses(userId, budgetRef, { weekStartsOn: settings.weekStartsOn, includeEnded: true }),
      listGoals(userId, today),
      listRecurring(userId, { includeInactive: false, today }),
      detectAnomaliesInRange(userId, range, money),
      getBalanceSummary(userId),
      calculateHealthScore(userId, today, settings),
    ]);

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    formulaVersion: HEALTH_FORMULA_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: settings.timezone,
    currency: settings.currency,
    period: { label, ...range, lastDay: lastDayOf(range) },
    previousPeriod: { ...previous, lastDay: lastDayOf(previous) },
    totals,
    previousTotals,
    changes: compareTotals(totals, previousTotals),
    categories,
    incomeSources,
    trend,
    merchants,
    budgets: budgets.filter((b) => b.cycle.start < range.end && b.cycle.end > range.start),
    goals,
    recurring: {
      monthlyExpenseLoad: round2(recurring.filter((r) => r.type === "EXPENSE").reduce((a, r) => a + r.monthlyEquivalent, 0)),
      monthlyIncome: round2(recurring.filter((r) => r.type === "INCOME").reduce((a, r) => a + r.monthlyEquivalent, 0)),
      activeCount: recurring.length,
    },
    anomalies,
    balancesAtGeneration: balances,
    healthScore,
    dataAvailability: availabilityOf(totals),
  };
}
