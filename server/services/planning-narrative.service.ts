import { z } from "zod";
import { formatMoney } from "@/lib/utils/format";
import { generateStructuredOutput } from "@/agents/provider";
import { agentSystemPrompt } from "@/agents/prompts";
import { isGrounded, numbersFrom } from "@/agents/grounding";
import { getMonthlyReview, type MonthlyReview } from "@/server/services/review.service";
import type { WhatIfInput, WhatIfResult } from "@/server/services/planning.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";
import { financialMonthOf } from "@/lib/dates/date-only";

/**
 * AI narration of already-computed numbers ("compute first, then narrate").
 * Every AI answer is checked for invented figures; on failure, or without an
 * AI provider, a deterministic template is returned.
 */

export interface Narrative {
  summary: string;
  points: string[];
  usedAI: boolean;
  /** The exact figures the narration was allowed to use. */
  basis: Record<string, unknown>;
}

const narrativeSchema = z.object({
  summary: z.string().min(1).max(900),
  points: z.array(z.string().min(1).max(300)).max(5).default([]),
});

const EXPLAIN_PROMPT =
  agentSystemPrompt("Month Explainer") +
  `
You receive DATA computed from the user's records for one financial month.
Explain in plain words what happened: where money came from, where it went,
what changed versus the previous month and anything unusual. Do not give
investment advice. Use only numbers present in DATA.
Respond with JSON: {"summary": "2-3 sentences", "points": ["up to 5 short points"]}`;

const WHATIF_PROMPT =
  agentSystemPrompt("Scenario Explainer") +
  `
You receive a deterministic what-if SCENARIO and its RESULT. Explain the
effect in plain words: the change versus the baseline, when (if ever) cash goes
negative, and the effect on the emergency cushion. Use only numbers in DATA.
Respond with JSON: {"summary": "2-3 sentences", "points": ["up to 4 short points"]}`;

async function narrate(prompt: string, basis: Record<string, unknown>, fallback: Omit<Narrative, "usedAI" | "basis">): Promise<Narrative> {
  const { value, usedAI } = await generateStructuredOutput(
    {
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `DATA (deterministic; do not invent any other number):\n${JSON.stringify(basis)}` },
      ],
      temperature: 0.2,
      maxTokens: 600,
    },
    narrativeSchema,
    { summary: fallback.summary, points: fallback.points }
  );
  if (usedAI) {
    const allowed = numbersFrom(basis);
    const text = [value.summary, ...(value.points ?? [])].join(" ");
    if (isGrounded(text, allowed)) return { summary: value.summary, points: value.points ?? [], usedAI: true, basis };
  }
  return { ...fallback, usedAI: false, basis };
}

function monthBasis(r: MonthlyReview) {
  return {
    month: r.period.label,
    complete: r.complete,
    income: r.totals.income,
    grossSpending: r.totals.grossExpense,
    refunds: r.totals.refunds,
    netSpending: r.totals.netSpending,
    surplus: r.totals.surplus,
    savingsRatePct: r.totals.savingsRate,
    previousNetSpending: r.previousTotals.netSpending,
    previousIncome: r.previousTotals.income,
    netSpendingChangePct: r.comparison.netSpendingPct,
    topCategories: r.categories.slice(0, 5).map((c) => ({ name: c.name, total: c.total, sharePct: c.percentage, changePct: c.changePct })),
    topMerchants: r.merchants.slice(0, 4).map((m) => ({ name: m.merchant, total: m.total, count: m.count })),
    budgetsOver: r.budgets.filter((b) => b.exceeded).map((b) => ({ name: b.name, spent: b.spent, limit: b.available })),
    billsMissed: r.bills.missed,
    netWorthChange: r.netWorth.change,
    unusual: r.anomalies.slice(0, 3).map((a) => ({ amount: a.amount, what: a.merchant ?? a.description ?? a.categoryName })),
  };
}

/** "Explain my month" for the current (default) or a given financial month. */
export async function explainMonth(userId: string, periodStart?: string): Promise<Narrative & { period: MonthlyReview["period"] }> {
  const settings = await getUserSettings(userId);
  const start = periodStart ?? financialMonthOf(todayFor(settings), settings.monthStartDay).start;
  const review = await getMonthlyReview(userId, start);
  const m = (n: number) => formatMoney(n, settings.currency);
  const t = review.totals;
  const points = [...review.highlights];
  if (review.comparison.netSpendingPct != null) {
    points.push(`Net spending is ${review.comparison.netSpendingPct >= 0 ? "up" : "down"} ${Math.abs(review.comparison.netSpendingPct)}% versus the previous month (${m(review.previousTotals.netSpending)}).`);
  }
  if (review.anomalies[0]) points.push(`Unusual: ${review.anomalies[0].reason}`);
  const fallback = {
    summary:
      t.transactionCount === 0
        ? `Nothing has been recorded for ${review.period.label} yet.`
        : `${review.complete ? "In" : "So far in"} ${review.period.label} you received ${m(t.income)} and spent ${m(t.netSpending)} net of refunds, leaving ${m(t.surplus)}.`,
    points: points.slice(0, 5),
  };
  const narrative = t.transactionCount === 0 ? { ...fallback, usedAI: false, basis: monthBasis(review) } : await narrate(EXPLAIN_PROMPT, monthBasis(review), fallback);
  return { ...narrative, period: review.period };
}

export async function narrateWhatIf(userId: string, input: WhatIfInput, r: WhatIfResult): Promise<Narrative> {
  const settings = await getUserSettings(userId);
  const m = (n: number) => formatMoney(n, settings.currency);
  const basis = {
    months: input.months,
    oneTimeExpense: r.scenario.oneTime,
    monthlyIncomeChange: input.monthlyIncomeChange ?? 0,
    monthlyExpenseChange: input.monthlyExpenseChange ?? 0,
    monthlyToGoals: r.scenario.monthlyToGoals,
    startLiquid: r.startLiquid,
    baselineMonthlySurplus: r.baseline.avgSurplus,
    scenarioMonthlySurplus: r.scenario.monthlySurplus,
    endBaseline: r.endBaseline,
    endScenario: r.endScenario,
    difference: r.difference,
    firstNegativeMonth: r.firstNegativeMonth,
    emergencyMonthsAfterOneTime: r.emergencyMonthsAfter,
  };
  const points = [
    `After ${input.months} month(s) your liquid money would be ${m(r.endScenario)} instead of ${m(r.endBaseline)}.`,
    r.firstNegativeMonth != null ? `Cash would run out in month ${r.firstNegativeMonth}.` : "Cash stays positive for the whole period.",
  ];
  if (r.emergencyMonthsAfter != null && r.scenario.oneTime > 0) points.push(`After the one-time cost, liquid money covers ${r.emergencyMonthsAfter} month(s) of essential spending.`);
  if (r.scenario.monthlyToGoals > 0) points.push(`${m(r.scenario.monthlyToGoals)} a month moves into goals; it's still yours but not in liquid cash.`);
  return narrate(WHATIF_PROMPT, basis, {
    summary: `This scenario changes your monthly surplus from ${m(r.baseline.avgSurplus)} to ${m(r.scenario.monthlySurplus)}; the difference after ${input.months} month(s) is ${m(r.difference)}.`,
    points,
  });
}
