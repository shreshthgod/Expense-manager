import { prisma } from "@/lib/db/prisma";
import { addDays, financialMonthOf, type ISODate } from "@/lib/dates/date-only";
import { monthlyEquivalent, type RecurrenceFrequency } from "@/lib/finance/recurrence";
import { clamp, mean, percentageOf, round2 } from "@/lib/utils/money";
import { totalsForWindows } from "@/server/analytics/definitions";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { forecastSpending } from "@/server/analytics/forecast";
import { trailingMonths, type PeriodSettings } from "@/server/analytics/ranges";
import { getBalanceSummary } from "@/server/services/account.service";

export interface HealthComponent {
  key: string;
  name: string;
  score: number;
  weight: number;
  detail: string;
  /** The exact computed values that produced the score ("why am I seeing this"). */
  inputs: { label: string; value: number | string | null }[];
  /** True when there was not enough data and a neutral default was used. */
  usedDefault: boolean;
}

export interface HealthScore {
  score: number;
  grade: "Excellent" | "Good" | "Fair" | "Needs attention";
  components: HealthComponent[];
  dataQualityMonths: number;
  formulaVersion: string;
}

export const HEALTH_FORMULA_VERSION = "2.0";

export function gradeFor(score: number): HealthScore["grade"] {
  return score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Needs attention";
}

const clampScore = (v: number) => Math.round(clamp(v, 0, 100));

/**
 * Deterministic financial health score (0-100). Weights are unchanged from v1:
 *   Savings rate 30 · Budget adherence 20 · Spending trend 15 ·
 *   Recurring load 10 · Goal progress 15 · Emergency fund 10.
 * v2 fixes: recurring INCOME no longer counts as load; the spending trend
 * compares the projected month with the 3-month average (v1 compared a partial
 * month with a full one); the emergency fund uses liquid money only.
 */
export async function calculateHealthScore(userId: string, today: ISODate, settings: PeriodSettings): Promise<HealthScore> {
  const current = financialMonthOf(today, settings.monthStartDay);
  const history = trailingMonths(addDays(current.start, -1), 3, settings);
  const [totals, budgets, goals, balances, recurring, forecast] = await Promise.all([
    totalsForWindows(userId, history.map((range, i) => ({ key: String(i), range }))),
    getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn }),
    prisma.savingsGoal.findMany({ where: { userId }, select: { targetAmount: true, currentAmount: true } }),
    getBalanceSummary(userId),
    prisma.recurringTransaction.findMany({
      where: { userId, active: true, type: "EXPENSE" },
      select: { amount: true, frequency: true },
    }),
    forecastSpending(userId, today, settings),
  ]);

  const months = history.map((_, i) => totals.get(String(i))!).filter((t) => t.transactionCount > 0);
  const n = months.length;
  const avgIncome = n ? mean(months.map((m) => m.income)) : 0;
  const avgSpend = n ? mean(months.map((m) => m.netSpending)) : 0;
  const components: HealthComponent[] = [];

  // 1. Savings rate
  const rates = months.filter((m) => m.savingsRate != null).map((m) => m.savingsRate as number);
  const avgRate = rates.length ? round2(mean(rates)) : null;
  components.push({
    key: "savings_rate",
    name: "Savings Rate",
    weight: 30,
    score: avgRate == null ? 50 : clampScore((avgRate / 30) * 100),
    usedDefault: avgRate == null,
    detail: avgRate == null ? "No income recorded in recent complete months" : `${avgRate}% average over ${rates.length} month(s); 30% or more scores 100`,
    inputs: [
      { label: "Average savings rate %", value: avgRate },
      { label: "Months with income", value: rates.length },
    ],
  });

  // 2. Budget adherence
  const active = budgets.filter((b) => b.cycle.state === "active");
  const within = active.filter((b) => !b.exceeded).length;
  components.push({
    key: "budget_adherence",
    name: "Budget Adherence",
    weight: 20,
    score: active.length ? clampScore((within / active.length) * 100) : 70,
    usedDefault: active.length === 0,
    detail: active.length ? `${within} of ${active.length} active budget(s) within their limit` : "No active budgets",
    inputs: [
      { label: "Active budgets", value: active.length },
      { label: "Within limit", value: within },
    ],
  });

  // 3. Spending trend: projected month vs 3-month average
  const projected = forecast.projectedMonthEndExpenses;
  const growth = avgSpend > 0 ? round2(((projected - avgSpend) / avgSpend) * 100) : null;
  components.push({
    key: "spending_trend",
    name: "Spending Trend",
    weight: 15,
    score: growth == null ? 60 : clampScore(100 - growth),
    usedDefault: growth == null,
    detail: growth == null ? "Not enough history to compare" : `Projected month ${growth >= 0 ? "+" : ""}${growth}% vs your 3-month average`,
    inputs: [
      { label: "Projected spending this month", value: projected },
      { label: "3-month average spending", value: round2(avgSpend) },
      { label: "Change %", value: growth },
    ],
  });

  // 4. Recurring load (expenses only)
  const monthlyRecurring = round2(
    recurring.reduce((acc, r) => acc + monthlyEquivalent(Number(r.amount), r.frequency as RecurrenceFrequency), 0)
  );
  const loadPct = avgIncome > 0 ? percentageOf(avgIncome, monthlyRecurring) : null;
  components.push({
    key: "recurring_load",
    name: "Recurring Load",
    weight: 10,
    score: loadPct == null ? (monthlyRecurring > 0 ? 50 : 70) : clampScore(100 - loadPct * 2),
    usedDefault: loadPct == null,
    detail: loadPct == null ? "Needs income history to compare" : `${loadPct}% of average income is committed to recurring expenses`,
    inputs: [
      { label: "Recurring expenses per month", value: monthlyRecurring },
      { label: "Average monthly income", value: round2(avgIncome) },
    ],
  });

  // 5. Goal progress
  const progress = goals.map((g) =>
    Number(g.targetAmount) > 0 ? Math.min(100, (Number(g.currentAmount) / Number(g.targetAmount)) * 100) : 0
  );
  components.push({
    key: "goal_progress",
    name: "Goal Progress",
    weight: 15,
    score: progress.length ? clampScore(mean(progress)) : 50,
    usedDefault: progress.length === 0,
    detail: progress.length ? `Average progress ${round2(mean(progress))}% across ${progress.length} goal(s)` : "No savings goals",
    inputs: [{ label: "Goals", value: progress.length }],
  });

  // 6. Emergency fund: liquid funds vs 3 months of spending
  const required = avgSpend * 3;
  components.push({
    key: "emergency_fund",
    name: "Emergency Fund",
    weight: 10,
    score: required > 0 ? clampScore((balances.liquid / required) * 100) : 50,
    usedDefault: required <= 0,
    detail: required > 0 ? `Liquid funds cover ${round2(balances.liquid / avgSpend)} month(s) of spending (3 scores 100)` : "No spending history yet",
    inputs: [
      { label: "Liquid funds", value: balances.liquid },
      { label: "Average monthly spending", value: round2(avgSpend) },
    ],
  });

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score = clampScore(components.reduce((a, c) => a + (c.score * c.weight) / totalWeight, 0));
  return { score, grade: gradeFor(score), components, dataQualityMonths: n, formulaVersion: HEALTH_FORMULA_VERSION };
}
