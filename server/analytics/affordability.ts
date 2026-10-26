import { prisma } from "@/lib/db/prisma";
import { addDays, financialMonthOf, type ISODate } from "@/lib/dates/date-only";
import { percentageOf, round2, safeDivide } from "@/lib/utils/money";
import { totalsForWindows } from "@/server/analytics/definitions";
import { trailingMonths, type PeriodSettings } from "@/server/analytics/ranges";
import { getBalanceSummary } from "@/server/services/account.service";
import type { Confidence } from "@/types";

export type AffordabilityVerdict = "can_afford" | "potentially_risky" | "not_recommended";

export interface AffordabilityResult {
  verdict: { key: AffordabilityVerdict; label: string };
  amount: number;
  liquidBalance: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  avgMonthlySurplus: number;
  pctOfMonthlySurplus: number | null;
  monthsToSaveIfDeferred: number | null;
  activeGoalPressure: boolean;
  confidence: Confidence;
  dataQualityMonths: number;
  /** Every assumption behind the verdict, shown to the user. */
  assumptions: string[];
}

const LABELS: Record<AffordabilityVerdict, string> = {
  can_afford: "Can afford",
  potentially_risky: "Potentially risky",
  not_recommended: "Not recommended",
};

/**
 * Deterministic affordability evaluation (informational, not advice):
 *  - can_afford:       liquid ≥ amount and amount ≤ 100% of average monthly surplus
 *  - potentially_risky: liquid + one month of surplus ≥ amount and amount ≤ 200% of surplus
 *  - not_recommended:  otherwise
 */
export async function evaluateAffordability(
  userId: string,
  amount: number,
  today: ISODate,
  settings: PeriodSettings
): Promise<AffordabilityResult> {
  const current = financialMonthOf(today, settings.monthStartDay);
  const history = trailingMonths(addDays(current.start, -1), 4, settings);
  const [totals, balances, goals] = await Promise.all([
    totalsForWindows(userId, history.map((range, i) => ({ key: String(i), range }))),
    getBalanceSummary(userId),
    prisma.savingsGoal.findMany({ where: { userId }, select: { deadline: true, targetAmount: true, currentAmount: true } }),
  ]);
  const months = history.map((_, i) => totals.get(String(i))!).filter((t) => t.transactionCount > 0);
  const n = months.length;
  const avgIncome = n ? months.reduce((a, t) => a + t.income, 0) / n : 0;
  const avgExpense = n ? months.reduce((a, t) => a + t.netSpending, 0) / n : 0;
  const surplus = round2(avgIncome - avgExpense);
  const liquid = balances.liquid;
  const pct = surplus > 0 ? percentageOf(surplus, amount) : null;

  let verdict: AffordabilityVerdict;
  if (liquid >= amount && pct != null && pct <= 100) verdict = "can_afford";
  else if (liquid + Math.max(0, surplus) >= amount && (pct == null || pct <= 200)) verdict = "potentially_risky";
  else verdict = "not_recommended";

  const activeGoalPressure = goals.some(
    (g) => g.deadline != null && g.deadline.toISOString().slice(0, 10) > today && Number(g.targetAmount) > Number(g.currentAmount)
  );

  return {
    verdict: { key: verdict, label: LABELS[verdict] },
    amount,
    liquidBalance: liquid,
    avgMonthlyIncome: round2(avgIncome),
    avgMonthlyExpenses: round2(avgExpense),
    avgMonthlySurplus: surplus,
    pctOfMonthlySurplus: pct,
    monthsToSaveIfDeferred: surplus > 0 ? Math.max(1, Math.ceil(safeDivide(Math.max(0, amount - liquid), surplus))) : null,
    activeGoalPressure,
    confidence: n >= 3 ? "high" : n >= 1 ? "medium" : "low",
    dataQualityMonths: n,
    assumptions: [
      "Liquid funds are your bank, savings, cash and wallet balances; credit limits and investments are not counted.",
      n
        ? `Average monthly income and net spending use your last ${n} complete month(s) of recorded transactions.`
        : "There is no complete month of history yet, so averages are zero.",
      "Planned (future) transactions and upcoming bills are not deducted in this check — see Safe to Spend for that.",
      "This is an informational estimate from your recorded data, not financial advice.",
    ],
  };
}
