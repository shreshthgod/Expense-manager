import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, fromDbDate, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";

/**
 * Deterministic unusual-expense detection.
 *
 * An expense is flagged when, compared with the user's OTHER expenses in the
 * same category over the preceding 90 days (at least 5 samples, amount ≥ 500):
 *   amount / mean ≥ 3   or   z-score ≥ 3
 * Uncategorised expenses are compared with all expenses.
 *
 * Statistics are computed with one aggregate query and exact leave-one-out
 * formulas (v1 ran one query per candidate — up to 100 sequential queries).
 */

export const MIN_ANOMALY_AMOUNT = 500;
export const RATIO_TRIGGER = 3;
export const ZSCORE_TRIGGER = 3;
export const MIN_SAMPLES = 5;
export const LOOKBACK_DAYS = 90;

export interface AnomalyStats {
  n: number;
  sum: number;
  sumSq: number;
}

export interface AnomalyVerdict {
  ratio: number;
  zScore: number | null;
  typicalAmount: number;
  samples: number;
}

/** Evaluates one amount against stats that may include the amount itself. */
export function evaluateAgainst(amount: number, stats: AnomalyStats, includesSelf: boolean): AnomalyVerdict | null {
  const n = includesSelf ? stats.n - 1 : stats.n;
  const sum = includesSelf ? stats.sum - amount : stats.sum;
  const sumSq = includesSelf ? stats.sumSq - amount * amount : stats.sumSq;
  if (n < MIN_SAMPLES || amount < MIN_ANOMALY_AMOUNT) return null;
  const mean = sum / n;
  if (mean <= 0) return null;
  const variance = n > 1 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
  const sd = Math.sqrt(variance);
  const ratio = round2(amount / mean);
  const zScore = sd > 0 ? round2((amount - mean) / sd) : null;
  const flagged = ratio >= RATIO_TRIGGER || (zScore != null ? zScore >= ZSCORE_TRIGGER : amount > mean);
  return flagged ? { ratio, zScore, typicalAmount: round2(mean), samples: n } : null;
}

export interface Anomaly {
  transactionId: string;
  merchant: string | null;
  description: string | null;
  amount: number;
  categoryId: string | null;
  categoryName: string | null;
  transactionDate: ISODate;
  ratio: number;
  zScore: number | null;
  typicalAmount: number;
  samples: number;
  /** Deterministic explanation with the numbers used. */
  reason: string;
}

interface CandidateRow {
  id: string;
  amount: Prisma.Decimal;
  merchant: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transactionDate: Date;
  n: bigint;
  s: Prisma.Decimal | null;
  q: Prisma.Decimal | null;
}

async function candidatesWithStats(userId: string, since: ISODate, today: ISODate, ids?: string[]): Promise<CandidateRow[]> {
  const idFilter = ids ? Prisma.sql`AND c."id" IN (${Prisma.join(ids)})` : Prisma.empty;
  const histStart = addDays(since, -LOOKBACK_DAYS);
  return prisma.$queryRaw<CandidateRow[]>`
    WITH hist AS (
      SELECT t."categoryId", t."amount", t."transactionDate"
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
        AND t."type"::text = 'EXPENSE'
        AND t."transactionDate" >= ${histStart}::date AND t."transactionDate" <= ${today}::date
    )
    SELECT c."id", c."amount", c."merchant", c."description", c."categoryId", cat."name" AS "categoryName",
           c."transactionDate",
           (SELECT COUNT(*) FROM hist h WHERE (c."categoryId" IS NULL OR h."categoryId" = c."categoryId")
              AND h."transactionDate" >= c."transactionDate" - ${LOOKBACK_DAYS}::int AND h."transactionDate" <= c."transactionDate") AS n,
           (SELECT SUM(h."amount") FROM hist h WHERE (c."categoryId" IS NULL OR h."categoryId" = c."categoryId")
              AND h."transactionDate" >= c."transactionDate" - ${LOOKBACK_DAYS}::int AND h."transactionDate" <= c."transactionDate") AS s,
           (SELECT SUM(h."amount" * h."amount") FROM hist h WHERE (c."categoryId" IS NULL OR h."categoryId" = c."categoryId")
              AND h."transactionDate" >= c."transactionDate" - ${LOOKBACK_DAYS}::int AND h."transactionDate" <= c."transactionDate") AS q
    FROM "Transaction" c
    LEFT JOIN "Category" cat ON cat."id" = c."categoryId"
    WHERE c."userId" = ${userId} AND c."status" = 'POSTED' AND c."deletedAt" IS NULL
      AND c."type"::text = 'EXPENSE' AND c."amount" >= ${MIN_ANOMALY_AMOUNT}
      AND c."transactionDate" >= ${since}::date AND c."transactionDate" <= ${today}::date
      ${idFilter}
    ORDER BY c."transactionDate" DESC, c."amount" DESC
    LIMIT 200`;
}

function toAnomaly(row: CandidateRow, formatAmount: (n: number) => string): Anomaly | null {
  const amount = Number(row.amount);
  const verdict = evaluateAgainst(amount, { n: Number(row.n), sum: Number(row.s ?? 0), sumSq: Number(row.q ?? 0) }, true);
  if (!verdict) return null;
  const scope = row.categoryName ? `${row.categoryName} expense` : "expense";
  return {
    transactionId: row.id,
    merchant: row.merchant,
    description: row.description,
    amount,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    transactionDate: fromDbDate(row.transactionDate),
    ...verdict,
    reason: `About ${verdict.ratio.toFixed(1)}× your typical ${scope} of ${formatAmount(verdict.typicalAmount)} (based on ${verdict.samples} expenses in the previous ${LOOKBACK_DAYS} days).`,
  };
}

const defaultFormat = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export async function detectRecentAnomalies(
  userId: string,
  today: ISODate,
  days = 30,
  formatAmount: (n: number) => string = defaultFormat
): Promise<Anomaly[]> {
  const rows = await candidatesWithStats(userId, addDays(today, -days), today);
  return rows.map((r) => toAnomaly(r, formatAmount)).filter((a): a is Anomaly => a != null).slice(0, 10);
}

/** Screens specific (newly created/edited) expenses. */
export async function evaluateExpenses(
  userId: string,
  ids: string[],
  today: ISODate,
  formatAmount: (n: number) => string = defaultFormat
): Promise<Anomaly[]> {
  if (ids.length === 0) return [];
  const rows = await candidatesWithStats(userId, addDays(today, -LOOKBACK_DAYS), today, ids);
  return rows.map((r) => toAnomaly(r, formatAmount)).filter((a): a is Anomaly => a != null);
}

/** Unusual expenses dated inside a range (reports). */
export async function detectAnomaliesInRange(
  userId: string,
  range: { start: ISODate; end: ISODate },
  formatAmount: (n: number) => string = defaultFormat
): Promise<Anomaly[]> {
  const rows = await candidatesWithStats(userId, range.start, addDays(range.end, -1));
  return rows.map((r) => toAnomaly(r, formatAmount)).filter((a): a is Anomaly => a != null).slice(0, 10);
}
