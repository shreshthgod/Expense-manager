import { z } from "zod";
import { generateStructuredOutput } from "./provider";
import { ANALYSIS_PROMPT } from "./prompts";
import { formatMoney } from "@/lib/utils/format";
import type { ToolResult } from "./tools";

const analysisSchema = z.object({
  findings: z.array(z.string().min(1)).max(6).default([]),
});

export type AnalysisResult = { findings: string[] };

export async function runAnalysisAgent(
  question: string,
  toolResults: ToolResult[],
  currency = "INR"
): Promise<AnalysisResult> {
  const dataBlock = toolResults
    .filter((r) => r.ok)
    .map((r) => `## ${r.tool}\n${JSON.stringify(r.data).slice(0, 3500)}`)
    .join("\n\n");

  const fallback: AnalysisResult = {
    findings: ["Analysis is based directly on the retrieved figures from your account."],
  };

  const { value, usedAI } = await generateStructuredOutput(
    {
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        {
          role: "user",
          content: `User question: "${question}"\n\nDATA from deterministic tools:\n${dataBlock || "(no data)"}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 500,
    },
    analysisSchema,
    { findings: fallback.findings }
  );

  const resolvedFindings = value.findings ?? fallback.findings;

  if (!usedAI && fallback.findings[0] === resolvedFindings[0] && hasMeaningfulData(toolResults)) {
    return { findings: deriveDeterministicFindings(toolResults, currency) };
  }
  return { findings: resolvedFindings };
}

function hasMeaningfulData(toolResults: ToolResult[]): boolean {
  return toolResults.some((r) => r.ok && r.data != null);
}

function deriveDeterministicFindings(toolResults: ToolResult[], currency: string): string[] {
  const m = (v: unknown) => (Number.isFinite(Number(v)) ? formatMoney(Number(v), currency) : String(v));
  const findings: string[] = [];
  for (const result of toolResults) {
    if (!result.ok) continue;
    const data = result.data as Record<string, unknown>;

    if (result.tool === "get_user_financial_summary" && typeof data.netSpending === "number") {
      const changes = data.changes as { netSpendingPct?: number | null } | undefined;
      const rate = data.savingsRatePct == null ? "savings rate not applicable (no income)" : `${fmt(data.savingsRatePct)}% savings rate`;
      findings.push(
        `Income ${m(data.income)} and net spending ${m(data.netSpending)} this period, leaving ${m(data.surplus)} (${rate}).`
      );
      if (changes?.netSpendingPct != null) {
        findings.push(`Net spending changed by ${changes.netSpendingPct > 0 ? "+" : ""}${changes.netSpendingPct}% compared with the previous period.`);
      }
    }

    if (result.tool === "get_account_balances" && typeof data.netWorth === "number") {
      findings.push(
        `Liquid funds ${m(data.liquid)}; assets ${m(data.totalAssets)} minus liabilities ${m(data.totalLiabilities)} gives a net worth of ${m(data.netWorth)}.`
      );
    }

    if (result.tool === "compare_periods" && Array.isArray(data)) {
      for (const row of (data as Record<string, unknown>[]).slice(0, 3)) {
        if (row.significant === true) {
          const change = typeof row.changePct === "number" ? row.changePct : null;
          findings.push(
            `${row.category}: ${m(row.current)} vs ${m(row.previous)} previously (${change != null ? `${change > 0 ? "+" : ""}${change}%` : "n/a"}).`
          );
        }
      }
    }

    if (result.tool === "get_budget_status" && Array.isArray(data)) {
      const rows = data as Record<string, unknown>[];
      const over = rows.filter((b) => b.exceeded === true);
      const near = rows.filter((b) => !b.exceeded && Number(b.utilization) >= 75);
      if (over.length) findings.push(`${over.map((b) => String(b.name)).join(", ")} budget(s) exceeded for the current cycle.`);
      if (near.length) findings.push(`${near.map((b) => `${String(b.name)} (${fmt(b.utilization)}%)`).join(", ")} above 75% used.`);
    }

    if (result.tool === "calculate_affordability") {
      const verdict = (data.verdict as { label?: string } | undefined)?.label ?? "undetermined";
      findings.push(
        `Affordability: ${verdict}, based on liquid funds ${m(data.liquidBalance)} and an average monthly surplus of ${m(data.avgMonthlySurplus)}.`
      );
    }

    if (result.tool === "get_recurring_transactions" && typeof data.totalMonthlyEquivalent === "number") {
      findings.push(
        `Recurring expenses total about ${m(data.totalMonthlyEquivalent)} per month across ${Array.isArray(data.items) ? data.items.length : 0} active item(s).`
      );
    }

    if (result.tool === "get_top_merchants" && Array.isArray(data) && data.length) {
      const top = data[0] as Record<string, unknown>;
      findings.push(`Top merchant: ${top.merchant} with ${m(top.total)} across ${top.count} purchase(s).`);
    }

    if (result.tool === "detect_anomalies" && Array.isArray(data) && data.length) {
      findings.push(`${data.length} unusually large expense(s) in the last 30 days.`);
    }
  }
  return findings.slice(0, 6);
}

function fmt(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
