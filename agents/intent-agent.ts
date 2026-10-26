import type { AIIntent } from "@/types";

export type ParsedPreset = "this_week" | "this_month" | "last_month" | "3_months" | "6_months" | "this_year";

export interface ParsedIntent {
  intent: AIIntent;
  amount: number | null;
  reportPeriod: { year: number; month?: number; quarter?: number } | null;
  /** Period mentioned in the question ("last month", "this year"…), if any. */
  preset: ParsedPreset | null;
  confidence: number;
}

export function parsePreset(text: string): ParsedPreset | null {
  const lower = text.toLowerCase();
  if (/last month|previous month/.test(lower)) return "last_month";
  if (/this week|past week|last 7 days/.test(lower)) return "this_week";
  if (/(last|past) (3|three) months|quarter/.test(lower)) return "3_months";
  if (/(last|past) (6|six) months/.test(lower)) return "6_months";
  if (/this year|year to date|ytd/.test(lower)) return "this_year";
  if (/this month|current month/.test(lower)) return "this_month";
  return null;
}

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const KEYWORDS: [AIIntent, RegExp[]][] = [
  ["NET_WORTH_ANALYSIS", [/net ?worth/i, /how much (money )?do i (have|own)/i, /\bassets?\b.*\bliabilit/i, /total balance/i, /\bmy balances?\b/i]],
  ["AFFORDABILITY_ANALYSIS", [/can (i|we) afford/i, /should i buy/i, /afford (a|an|to)/i, /worth buying/i]],
  ["REPORT_GENERATION", [/\b(create|generate|make|build|prepare)\b.*\breport\b/i, /\breport\b.*\b(for|of)\b/i, /monthly report/i, /yearly report/i, /quarterly report/i]],
  ["SUBSCRIPTION_ANALYSIS", [/subscription/i, /recurring/i, /netflix|spotify|prime/i]],
  ["BUDGET_ANALYSIS", [/\bbudget\b/i, /overspending/i, /spending limit/i]],
  ["GOAL_ANALYSIS", [/\bgoal(s)?\b/i, /emergency fund/i, /saving for/i, /target/i]],
  ["SAVINGS_ADVICE", [/where can i save/i, /how (much )?can i save/i, /save more/i, /savings rate/i, /cut (costs|spending)/i]],
  ["SPENDING_ANALYSIS", [/why.*(spend|expense)/i, /spend(ing)? (more|less|so much|too much)/i, /(highest|biggest|top) (spending )?categor/i, /expense(s)? (trend|increase|analysis)/i, /how (much )?(did|i) (i )?spend/i, /spending pattern/i]],
];

export function parseAmount(text: string): number | null {
  const kMatch = text.match(/(?:₹|rs\.?|inr)?\s*([\d][\d,]*(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const value = Number(kMatch[1]?.replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return value * 1000;
  }
  const match = text.match(/(?:₹\s*([\d][\d,]*(?:\.\d+)?))|(?:(?:rs\.?|inr|rupees?)\s*([\d][\d,]*(?:\.\d+)?))|(?:([\d][\d,]*(?:\.\d+)?)\s*(?:₹|rs\.?|inr|rupees?))/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseReportPeriod(
  text: string,
  now = new Date()
): { year: number; month?: number; quarter?: number } | null {
  const lower = text.toLowerCase();
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const year = yearMatch?.[1] ? Number(yearMatch[1]) : now.getFullYear();

  const quarterMatch = lower.match(/\bq([1-4])\b/);
  if (quarterMatch?.[1]) {
    return { year, quarter: Number(quarterMatch[1]) };
  }

  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i]!)) {
      let resolvedYear = year;
      if (!yearMatch && i > now.getMonth()) resolvedYear = now.getFullYear() - 1;
      return { year: resolvedYear, month: i + 1 };
    }
  }

  if (/this month|current month/.test(lower)) return { year, month: now.getMonth() + 1 };
  if (/last month|previous month/.test(lower)) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
  }
  if (/this year|annual/.test(lower)) return { year };
  return null;
}

function toDate(today?: string | Date): Date {
  if (today instanceof Date) return today;
  if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  return new Date();
}

/** Deterministic keyword-based intent classification — no AI call needed. */
export function classifyIntent(message: string, today?: string | Date): ParsedIntent {
  const now = toDate(today);
  const preset = parsePreset(message);
  for (const [intent, patterns] of KEYWORDS) {
    if (patterns.some((p) => p.test(message))) {
      return {
        intent,
        amount: parseAmount(message),
        reportPeriod: intent === "REPORT_GENERATION" ? parseReportPeriod(message, now) : null,
        preset,
        confidence: 0.9,
      };
    }
  }
  if (parseAmount(message)) {
    return { intent: "GENERAL_QUESTION", amount: parseAmount(message), reportPeriod: null, preset, confidence: 0.5 };
  }
  return { intent: "GENERAL_QUESTION", amount: null, reportPeriod: parseReportPeriod(message, now), preset, confidence: 0.4 };
}
