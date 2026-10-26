import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { fromMinor, percentChange, round2, toMinor } from "@/lib/utils/money";
import type { DateRange } from "@/lib/dates/date-only";

/**
 * CANONICAL FINANCIAL DEFINITIONS — reused by dashboard, analytics, budgets,
 * reports, exports and AI tools. Change them here only.
 *
 *   actual           = status POSTED and not deleted (PLANNED rows are projections)
 *   income           = Σ INCOME
 *   grossExpense     = Σ EXPENSE
 *   refunds          = Σ REFUND (by the refund's own posting date)
 *   netSpending      = grossExpense − refunds           (may be negative)
 *   surplus          = income − netSpending              ("net savings")
 *   savingsRate      = surplus / income × 100            only when income > 0, else null
 *   TRANSFER / ADJUSTMENT never count as income or spending.
 *
 * Ranges are start-inclusive / end-exclusive calendar dates.
 */

export interface PeriodTotals {
  income: number;
  grossExpense: number;
  refunds: number;
  netSpending: number;
  surplus: number;
  /** null = "not applicable" (no income in the period). */
  savingsRate: number | null;
  transactionCount: number;
}

export function savingsRateOf(income: number, surplus: number): number | null {
  if (!(income > 0)) return null;
  return round2((surplus / income) * 100);
}

export function totalsFrom(raw: { income: number; grossExpense: number; refunds: number; count: number }): PeriodTotals {
  const netMinor = toMinor(raw.grossExpense) - toMinor(raw.refunds);
  const surplusMinor = toMinor(raw.income) - netMinor;
  const income = fromMinor(toMinor(raw.income));
  const surplus = fromMinor(surplusMinor);
  return {
    income,
    grossExpense: fromMinor(toMinor(raw.grossExpense)),
    refunds: fromMinor(toMinor(raw.refunds)),
    netSpending: fromMinor(netMinor),
    surplus,
    savingsRate: savingsRateOf(income, surplus),
    transactionCount: raw.count,
  };
}

export interface Window {
  key: string;
  range: DateRange;
}

/** Period totals for many windows in ONE query. */
export async function totalsForWindows(userId: string, windows: Window[]): Promise<Map<string, PeriodTotals>> {
  const out = new Map<string, PeriodTotals>();
  if (windows.length === 0) return out;
  const keys = windows.map((w) => w.key);
  const starts = windows.map((w) => w.range.start);
  const ends = windows.map((w) => w.range.end);
  const rows = await prisma.$queryRaw<
    { key: string; income: Prisma.Decimal; expense: Prisma.Decimal; refunds: Prisma.Decimal; count: bigint }[]
  >`
    WITH w AS (
      SELECT * FROM unnest(${keys}::text[], ${starts}::text[]::date[], ${ends}::text[]::date[]) AS w(key, s, e)
    )
    SELECT w.key,
      COALESCE(SUM(t."amount") FILTER (WHERE t."type"::text = 'INCOME'), 0) AS income,
      COALESCE(SUM(t."amount") FILTER (WHERE t."type"::text = 'EXPENSE'), 0) AS expense,
      COALESCE(SUM(t."amount") FILTER (WHERE t."type"::text = 'REFUND'), 0) AS refunds,
      COUNT(t."id") FILTER (WHERE t."type"::text IN ('INCOME', 'EXPENSE', 'REFUND')) AS count
    FROM w
    LEFT JOIN "Transaction" t
      ON t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
     AND t."transactionDate" >= w.s AND t."transactionDate" < w.e
    GROUP BY w.key`;
  for (const r of rows) {
    out.set(
      r.key,
      totalsFrom({ income: Number(r.income), grossExpense: Number(r.expense), refunds: Number(r.refunds), count: Number(r.count) })
    );
  }
  for (const w of windows) {
    if (!out.has(w.key)) out.set(w.key, totalsFrom({ income: 0, grossExpense: 0, refunds: 0, count: 0 }));
  }
  return out;
}

export async function totalsForRange(userId: string, range: DateRange): Promise<PeriodTotals> {
  const map = await totalsForWindows(userId, [{ key: "r", range }]);
  return map.get("r")!;
}

export interface PeriodComparison {
  incomePct: number | null;
  netSpendingPct: number | null;
  surplusPct: number | null;
  savingsRateDelta: number | null;
}

export function compareTotals(current: PeriodTotals, previous: PeriodTotals): PeriodComparison {
  return {
    incomePct: percentChange(previous.income, current.income),
    netSpendingPct: percentChange(previous.netSpending, current.netSpending),
    surplusPct: previous.surplus > 0 ? percentChange(previous.surplus, current.surplus) : null,
    savingsRateDelta:
      current.savingsRate != null && previous.savingsRate != null ? round2(current.savingsRate - previous.savingsRate) : null,
  };
}

/**
 * Category allocation of spending: EXPENSE counts +, REFUND counts − in its
 * category. (Splits, when present, replace the parent's single category — see
 * `categorySpendSql`.)
 */
export const SPEND_SIGN = Prisma.sql`(CASE WHEN t."type"::text = 'EXPENSE' THEN 1 WHEN t."type"::text = 'REFUND' THEN -1 ELSE 0 END)`;
