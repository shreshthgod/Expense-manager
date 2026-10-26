import { z } from "zod";
import { formatMoney } from "@/lib/utils/format";
import { generateStructuredOutput } from "./provider";
import { DECISION_PROMPT } from "./prompts";
import type { AnalysisResult } from "./analysis-agent";
import type { ToolResult } from "./tools";
import type { AIIntent, Confidence, Recommendation } from "@/types";

const decisionSchema = z.object({
  summary: z.string().min(1).max(1200),
  recommendations: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        detail: z.string().min(1).max(500),
        reason: z.string().min(1).max(400),
        evidence: z.array(z.string().max(200)).max(5).default([]),
        expectedImpact: z.string().min(1).max(300),
        confidence: z.enum(["high", "medium", "low"]),
      })
    )
    .max(3)
    .default([]),
});

export interface DecisionResult {
  summary: string;
  recommendations: Recommendation[];
  usedAI: boolean;
}

export async function runDecisionAgent(params: {
  question: string;
  intent: AIIntent;
  analysis: AnalysisResult;
  toolResults: ToolResult[];
  dataMonths: number;
  currency: string;
  history?: { role: "USER" | "ASSISTANT"; content: string }[];
}): Promise<DecisionResult> {
  const fallback = buildDeterministicDecision(params);
  const history = (params.history ?? [])
    .slice(-6)
    .map((h) => `${h.role === "USER" ? "User" : "Assistant"}: ${h.content.slice(0, 400)}`)
    .join("\n");

  const { value, usedAI } = await generateStructuredOutput(
    {
      messages: [
        { role: "system", content: DECISION_PROMPT },
        {
          role: "user",
          content:
            (history ? `Earlier in this conversation (context only, not data):\n${history}\n\n` : "") +
            `User question: "${params.question}"\nIntent: ${params.intent}\nCurrency: ${params.currency}\nData coverage: ${params.dataMonths} month(s)\n\nFINDINGS:\n${params.analysis.findings.map((f) => `- ${f}`).join("\n")}\n\nDATA extract:\n${compactData(params.toolResults)}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 700,
    },
    decisionSchema,
    { summary: fallback.summary, recommendations: fallback.recommendations }
  );

  return {
    summary: value.summary ?? fallback.summary,
    recommendations: (value.recommendations ?? []).map((r) => ({
      title: r.title,
      detail: r.detail,
      reason: r.reason,
      evidence: r.evidence ?? [],
      expectedImpact: r.expectedImpact,
      confidence: r.confidence,
    })),
    usedAI,
  };
}

function compactData(toolResults: ToolResult[]): string {
  return toolResults
    .filter((r) => r.ok)
    .slice(0, 5)
    .map((r) => `${r.tool}: ${JSON.stringify(r.data).slice(0, 1800)}`)
    .join("\n");
}

function buildDeterministicDecision(params: {
  intent: AIIntent;
  analysis: AnalysisResult;
  toolResults: ToolResult[];
  dataMonths: number;
  currency: string;
}): { summary: string; recommendations: Recommendation[] } {
  const m = (v: unknown) => formatMoney(Number(v) || 0, params.currency);
  const confidence: Confidence = params.dataMonths >= 2 ? "high" : params.dataMonths === 1 ? "medium" : "low";
  const recommendations: Recommendation[] = [];
  const find = (tool: string) => params.toolResults.find((r) => r.tool === tool && r.ok);

  let headline = params.analysis.findings[0] ?? "Here is what your recorded data shows.";
  const summaryTool = find("get_user_financial_summary");
  if (summaryTool) {
    const d = summaryTool.data as Record<string, unknown>;
    const rate = d.savingsRatePct == null ? "no income recorded, so a savings rate doesn't apply" : `a ${d.savingsRatePct}% savings rate`;
    headline = `You received ${m(d.income)} and your net spending was ${m(d.netSpending)}, leaving ${m(d.surplus)} (${rate}).`;
  }
  const balances = find("get_account_balances");
  if (balances && params.intent === "GENERAL_QUESTION") {
    const d = balances.data as Record<string, unknown>;
    headline = `Your net worth is ${m(d.netWorth)} (assets ${m(d.totalAssets)} − liabilities ${m(d.totalLiabilities)}), with ${m(d.liquid)} in liquid funds.`;
  }
  const affordability = find("calculate_affordability");
  if (affordability) {
    const d = affordability.data as Record<string, unknown>;
    const verdict = (d.verdict as { label?: string })?.label ?? "Undetermined";
    headline = `${verdict}: ${m(d.amount)} compared with ${m(d.liquidBalance)} in liquid funds and an average monthly surplus of ${m(d.avgMonthlySurplus)}. This is an estimate from your recorded data, not advice.`;
  }

  const budgets = find("get_budget_status");
  if (budgets && Array.isArray(budgets.data)) {
    for (const b of budgets.data as Record<string, unknown>[]) {
      if (b.exceeded === true) {
        recommendations.push({
          title: `Review the ${b.name} budget`,
          detail: `It is over its limit by ${m(Number(b.spent) - Number(b.amount))} in the current cycle.`,
          reason: `${m(b.spent)} spent of ${m(b.amount)}.`,
          evidence: [`Utilization: ${b.utilization}%`, `Days left in cycle: ${b.daysRemaining}`],
          expectedImpact: "Keeping the limit realistic makes overspending visible earlier.",
          confidence,
        });
      }
    }
  }

  const categories = find("get_expenses_by_category");
  if (categories && Array.isArray(categories.data)) {
    const top = (categories.data as Record<string, unknown>[])[0];
    if (top && Number(top.total) > 0) {
      const change = typeof top.changeVsPreviousPeriodPct === "number" ? top.changeVsPreviousPeriodPct : null;
      recommendations.push({
        title: `Look at ${top.category} spending`,
        detail: `It is your largest category at ${top.percentageOfSpending}% of net spending.`,
        reason: `${m(top.total)} across ${top.transactions} transaction(s).`,
        evidence: [`Average transaction ${m(top.averageTransaction)}`, change != null ? `Change vs previous period ${change}%` : "No previous period to compare"],
        expectedImpact:
          change != null && change > 15
            ? `Returning to the previous level would free about ${m(Number(top.total) - Number(top.previousTotal ?? 0))}.`
            : "Keeping this category steady protects your surplus.",
        confidence,
      });
    }
  }

  const recurring = find("get_recurring_transactions");
  if (recurring) {
    const monthly = Number((recurring.data as Record<string, unknown>).totalMonthlyEquivalent ?? 0);
    if (monthly > 0) {
      recommendations.push({
        title: "Review your recurring costs",
        detail: "Check which recurring items and subscriptions you still use.",
        reason: `Active recurring expenses are about ${m(monthly)} per month (${m(monthly * 12)} per year).`,
        evidence: ["Monthly equivalents of your active recurring expenses"],
        expectedImpact: "Only you can judge which services are worth keeping.",
        confidence,
      });
    }
  }

  return { summary: headline, recommendations: recommendations.slice(0, 3) };
}
