import { z } from "zod";
import { formatMoney } from "@/lib/utils/format";
import type { ReportDataset } from "@/server/services/report-data.service";
import { generateStructuredOutput } from "./provider";
import { NARRATIVE_PROMPT } from "./prompts";

/**
 * Report narration. The dataset is computed deterministically first
 * (server/services/report-data.service.ts); this module only turns those
 * numbers into prose. Without an AI provider a template narrative is used, so
 * reports always work.
 */

const narrativeSchema = z.object({
  executiveSummary: z.string().min(1).max(1200),
  insights: z.array(z.string().min(1).max(400)).max(5).default([]),
  recommendations: z
    .array(z.object({ title: z.string().min(1).max(120), detail: z.string().min(1).max(400), expectedImpact: z.string().min(1).max(240) }))
    .max(4)
    .default([]),
});

export interface ReportNarrative {
  executiveSummary: string;
  insights: string[];
  recommendations: { title: string; detail: string; expectedImpact: string }[];
  usedAI: boolean;
}

export function templateNarrative(d: ReportDataset): ReportNarrative {
  const m = (n: number) => formatMoney(n, d.currency);
  const t = d.totals;
  const top = d.categories.find((c) => c.total > 0);
  const insights: string[] = [];
  if (top) insights.push(`${top.name} was the largest spending category at ${m(top.total)} (${top.percentage}% of net spending).`);
  const riser = d.categories.find((c) => (c.changePct ?? 0) >= 15 && c.previousTotal > 0);
  if (riser?.changePct != null) {
    insights.push(`${riser.name} rose ${riser.changePct}% versus the previous period (${m(riser.previousTotal)} → ${m(riser.total)}).`);
  }
  if (t.refunds > 0) insights.push(`Refunds of ${m(t.refunds)} reduced gross spending of ${m(t.grossExpense)} to ${m(t.netSpending)}.`);
  const over = d.budgets.filter((b) => b.exceeded);
  if (over.length) insights.push(`${over.length} budget(s) went over their limit: ${over.map((b) => b.name).join(", ")}.`);
  if (d.changes.netSpendingPct != null) {
    insights.push(`Net spending ${d.changes.netSpendingPct >= 0 ? "rose" : "fell"} ${Math.abs(d.changes.netSpendingPct)}% compared with the previous period.`);
  }
  if (d.recurring.monthlyExpenseLoad > 0) insights.push(`Recurring commitments are about ${m(d.recurring.monthlyExpenseLoad)} per month.`);

  const recommendations: ReportNarrative["recommendations"] = [];
  if (riser && riser.total - riser.previousTotal >= 100) {
    recommendations.push({
      title: `Review ${riser.name} spending`,
      detail: `It went from ${m(riser.previousTotal)} to ${m(riser.total)}. Check the transactions behind the increase.`,
      expectedImpact: `Returning to the previous level would free about ${m(riser.total - riser.previousTotal)} per period.`,
    });
  }
  if (over.length) {
    recommendations.push({
      title: "Revisit exceeded budgets",
      detail: `Adjust the limits of ${over.map((b) => b.name).join(", ")} to realistic levels or tighten spending in those categories.`,
      expectedImpact: "Budgets that reflect reality make overspending visible earlier.",
    });
  }
  if (t.savingsRate != null && t.savingsRate < 20) {
    recommendations.push({
      title: "Look at your savings rate",
      detail: `You kept ${t.savingsRate}% of income this period.`,
      expectedImpact: `Each additional 5 points of savings rate is about ${m(t.income * 0.05)} for a period like this one.`,
    });
  }

  const rate = t.savingsRate == null ? "a savings rate that isn't applicable (no income recorded)" : `a ${t.savingsRate}% savings rate`;
  const summary =
    `During ${d.period.label} you received ${m(t.income)} and your net spending was ${m(t.netSpending)}, leaving ${m(t.surplus)} (${rate}).` +
    (top ? ` ${top.name} was the largest category.` : "") +
    (over.length ? ` ${over.length} budget(s) exceeded their limit.` : d.budgets.length ? " All budgets stayed within their limits." : "") +
    ` Financial health score at generation: ${d.healthScore.score}/100 (${d.healthScore.grade}).`;

  return {
    executiveSummary:
      d.dataAvailability === "low"
        ? `${summary} Only ${t.transactionCount} transaction(s) were recorded in this period, so treat conclusions as preliminary.`
        : summary,
    insights: insights.slice(0, 5),
    recommendations: recommendations.slice(0, 4),
    usedAI: false,
  };
}

export async function narrateReport(d: ReportDataset): Promise<ReportNarrative> {
  const fallback = templateNarrative(d);
  if (d.dataAvailability === "low") return fallback;

  const compact = {
    period: d.period.label,
    currency: d.currency,
    income: d.totals.income,
    grossSpending: d.totals.grossExpense,
    refunds: d.totals.refunds,
    netSpending: d.totals.netSpending,
    surplus: d.totals.surplus,
    savingsRatePct: d.totals.savingsRate,
    changesVsPreviousPeriod: d.changes,
    topCategories: d.categories.slice(0, 6).map((c) => ({ category: c.name, total: c.total, sharePct: c.percentage, changePct: c.changePct })),
    topMerchants: d.merchants.slice(0, 5).map((mm) => ({ merchant: mm.merchant, total: mm.total, count: mm.count })),
    budgets: d.budgets.map((b) => ({ name: b.name, utilizationPct: b.utilization, spent: b.spent, limit: b.amount, exceeded: b.exceeded })),
    goals: d.goals.map((g) => ({ name: g.name, progressPct: g.progressPct, overdue: g.overdue })),
    recurringMonthlyLoad: d.recurring.monthlyExpenseLoad,
    anomalies: d.anomalies.slice(0, 3).map((a) => ({ amount: a.amount, reason: a.reason })),
    healthScore: { score: d.healthScore.score, grade: d.healthScore.grade },
    transactionCount: d.totals.transactionCount,
  };

  const { value, usedAI } = await generateStructuredOutput(
    {
      messages: [
        { role: "system", content: NARRATIVE_PROMPT },
        {
          role: "user",
          content: `STATISTICS (deterministic; do not invent any other number):\n${JSON.stringify(compact)}\n\nData availability: ${d.dataAvailability}.`,
        },
      ],
      temperature: 0.3,
      maxTokens: 800,
    },
    narrativeSchema,
    fallback
  );
  return usedAI
    ? { executiveSummary: value.executiveSummary, insights: value.insights ?? [], recommendations: value.recommendations ?? [], usedAI: true }
    : fallback;
}
