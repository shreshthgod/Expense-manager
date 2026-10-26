import type { AgentChatResponse, AIIntent, ProposedAction } from "@/types";
import { formatMoney } from "@/lib/utils/format";
import { classifyIntent } from "./intent-agent";
import { planTools, MAX_TOOL_ITERATIONS } from "./planner-agent";
import { executeTool, type ToolResult } from "./tools";
import { runAnalysisAgent } from "./analysis-agent";
import { runDecisionAgent } from "./decision-agent";
import { appendMessage, getOrCreateConversation, hasEnoughDataForAI, recentMessages } from "@/server/services/chat.service";
import { generateReport } from "@/server/services/report.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Chat pipeline: intent → planner → deterministic tools → analysis → decision.
 * The model (when configured) only phrases findings computed by the tools; with
 * no provider the deterministic path answers on its own.
 */
export async function runAgentChat(params: { userId: string; message: string; conversationId?: string }): Promise<AgentChatResponse> {
  const settings = await getUserSettings(params.userId);
  const today = todayFor(settings);
  const ctx = { userId: params.userId, settings, today };
  const parsed = classifyIntent(params.message, today);
  const conversation = await getOrCreateConversation(params.userId, params.conversationId, params.message);
  const history = await recentMessages(params.userId, conversation.id, 6);
  await appendMessage({ conversationId: conversation.id, role: "USER", content: params.message });

  if (parsed.intent === "REPORT_GENERATION" && parsed.reportPeriod) {
    return runReportIntent(params.userId, conversation.id, parsed.intent, parsed.reportPeriod);
  }

  const toolPlan = planTools(parsed.intent, parsed).slice(0, MAX_TOOL_ITERATIONS);
  const results: ToolResult[] = [];
  for (const toolName of toolPlan) {
    const input = toolName === "calculate_affordability" && parsed.amount ? { amount: parsed.amount } : parsed.preset ? { preset: parsed.preset } : {};
    results.push(await executeTool(ctx, toolName, input));
  }

  if (!(await hasEnoughDataForAI(params.userId))) {
    return finalize(conversation.id, parsed.intent, {
      summary:
        "There isn't enough recorded activity yet to analyse. Add a few transactions (or import a statement) and I'll be able to answer questions about your spending, budgets and goals.",
      findings: [],
      recommendations: [],
      evidence: [],
      confidence: "low",
      usedAI: false,
      toolsRun: results.map((r) => r.tool),
    });
  }

  const analysis = await runAnalysisAgent(params.message, results, settings.currency);
  const decision = await runDecisionAgent({
    question: params.message,
    intent: parsed.intent,
    analysis,
    toolResults: results,
    dataMonths: dataMonthsFrom(results),
    currency: settings.currency,
    history,
  });

  return finalize(conversation.id, parsed.intent, {
    actions: proposeActions(parsed.intent, results, today),
    summary: decision.summary,
    findings: analysis.findings,
    recommendations: decision.recommendations,
    evidence: buildEvidence(results, settings.currency),
    confidence: decision.recommendations.length ? lowestConfidence(decision.recommendations.map((r) => r.confidence)) : "medium",
    usedAI: decision.usedAI,
    toolsRun: results.map((r) => r.tool),
  });
}

async function runReportIntent(
  userId: string,
  conversationId: string,
  intent: AIIntent,
  period: { year: number; month?: number; quarter?: number }
): Promise<AgentChatResponse> {
  try {
    const report = await generateReport(userId, {
      type: period.month ? "MONTHLY" : period.quarter ? "QUARTERLY" : "YEARLY",
      year: period.year,
      month: period.month,
      quarter: period.quarter,
    });
    return finalize(conversationId, intent, {
      summary: `Your ${report.title} is ready. ${report.summary}`,
      findings: [],
      recommendations: [],
      evidence: [{ label: "Health score at generation", value: `${report.healthScore ?? "—"}/100` }],
      confidence: "high",
      usedAI: report.usedAI,
      toolsRun: ["build_report_dataset"],
      reportId: report.id,
    });
  } catch (error) {
    console.error("[agent] report generation failed:", error);
    return finalize(conversationId, intent, {
      summary: "I couldn't generate that report right now. You can generate it from the Reports page.",
      findings: [],
      recommendations: [],
      evidence: [],
      confidence: "low",
      usedAI: false,
      toolsRun: [],
    });
  }
}

function dataMonthsFrom(results: ToolResult[]): number {
  for (const r of results) {
    if (!r.ok || typeof r.data !== "object" || r.data === null) continue;
    const d = r.data as Record<string, unknown>;
    if (typeof d.dataQualityMonths === "number") return d.dataQualityMonths;
  }
  return 1;
}

function buildEvidence(results: ToolResult[], currency: string): { label: string; value: string }[] {
  const m = (v: unknown) => formatMoney(Number(v) || 0, currency);
  const evidence: { label: string; value: string }[] = [];
  for (const result of results) {
    if (!result.ok || typeof result.data !== "object" || result.data === null) continue;
    const d = result.data as Record<string, unknown>;
    if (result.tool === "get_user_financial_summary") {
      evidence.push({ label: "Income", value: m(d.income) });
      evidence.push({ label: "Net spending", value: m(d.netSpending) });
      evidence.push({ label: "Savings rate", value: d.savingsRatePct == null ? "Not applicable" : `${d.savingsRatePct}%` });
    }
    if (result.tool === "get_account_balances") {
      evidence.push({ label: "Net worth", value: m(d.netWorth) });
      evidence.push({ label: "Liquid funds", value: m(d.liquid) });
    }
    if (result.tool === "get_expenses_by_category" && Array.isArray(d)) {
      const top = (d as Record<string, unknown>[])[0];
      if (top) evidence.push({ label: "Top category", value: `${top.category} — ${m(top.total)} (${top.percentageOfSpending}%)` });
    }
    if (result.tool === "calculate_affordability") {
      evidence.push({ label: "Verdict", value: String((d.verdict as { label?: string })?.label ?? "—") });
      evidence.push({ label: "Liquid funds", value: m(d.liquidBalance) });
    }
    if (result.tool === "calculate_savings_rate") {
      evidence.push({ label: "Average monthly surplus", value: m(d.expectedMonthlySurplus) });
    }
  }
  return evidence.slice(0, 6);
}

function lowestConfidence(values: ("high" | "medium" | "low")[]): "high" | "medium" | "low" {
  if (values.includes("low")) return "low";
  if (values.includes("medium")) return "medium";
  return "high";
}

async function finalize(
  conversationId: string,
  intent: AIIntent,
  payload: Omit<AgentChatResponse, "conversationId" | "intent">
): Promise<AgentChatResponse> {
  await appendMessage({
    conversationId,
    role: "ASSISTANT",
    content: payload.summary,
    metadata: {
      intent,
      findings: payload.findings,
      recommendations: payload.recommendations,
      evidence: payload.evidence,
      confidence: payload.confidence,
      usedAI: payload.usedAI,
      toolsRun: payload.toolsRun,
      reportId: payload.reportId ?? null,
      actions: payload.actions ?? [],
    },
  });
  return { ...payload, conversationId, intent };
}

/**
 * Deterministic action proposals. Budget suggestion: the largest spending
 * category, at its current net spending rounded up to the next 500. The user
 * must confirm; the normal budgets API then validates it (duplicates, etc.).
 */
export function proposeActions(intent: AIIntent, results: ToolResult[], today: string): ProposedAction[] {
  const actions: ProposedAction[] = [];
  const cats = results.find((r) => r.ok && r.tool === "get_expenses_by_category")?.data as
    | { categoryId: string | null; category: string; total: number }[]
    | undefined;
  const budgets = results.find((r) => r.ok && r.tool === "get_budget_status")?.data as { categoryId?: string | null }[] | undefined;
  const top = Array.isArray(cats) ? cats.find((c) => c.categoryId && c.total > 0) : undefined;
  if (top && (intent === "BUDGET_ANALYSIS" || intent === "SPENDING_ANALYSIS" || intent === "SAVINGS_ADVICE")) {
    const covered = Array.isArray(budgets) && budgets.some((b) => b.categoryId === top.categoryId);
    if (!covered) {
      actions.push({
        kind: "create_budget",
        label: `Create a ${top.category} budget`,
        reason: `${top.category} is your largest spending category this period.`,
        payload: { name: top.category, categoryId: top.categoryId!, amount: Math.ceil(top.total / 500) * 500, period: "MONTHLY", startDate: `${today.slice(0, 7)}-01` },
      });
    }
    actions.push({ kind: "open", label: `See ${top.category} transactions`, reason: "Review what made up this category.", href: `/transactions?type=EXPENSE&categoryId=${top.categoryId}` });
  }
  if (intent === "SUBSCRIPTION_ANALYSIS") actions.push({ kind: "open", label: "Review subscriptions", reason: "See each subscription's monthly and yearly cost.", href: "/subscriptions" });
  if (intent === "GOAL_ANALYSIS") actions.push({ kind: "open", label: "Open goals", reason: "Add money or adjust a plan.", href: "/goals" });
  if (intent === "AFFORDABILITY_ANALYSIS") actions.push({ kind: "open", label: "Try it in the what-if planner", reason: "See the effect on your cash over the coming months.", href: "/cash-flow" });
  return actions.slice(0, 3);
}
