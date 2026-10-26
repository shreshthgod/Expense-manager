import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { percentChange, round2 } from "@/lib/utils/money";

export interface MerchantSpend {
  merchant: string;
  total: number;
  count: number;
  average: number;
  lastDate: ISODate;
  previousTotal: number;
  changePct: number | null;
}

/**
 * Net spending grouped by merchant. Merchants are grouped case-insensitively
 * on the trimmed name (the original text is kept on each transaction).
 */
export async function getTopMerchants(userId: string, range: DateRange, previous: DateRange | null, limit = 10): Promise<MerchantSpend[]> {
  const prevFilter = previous
    ? Prisma.sql`t."transactionDate" >= ${previous.start}::date AND t."transactionDate" < ${previous.end}::date`
    : Prisma.sql`FALSE`;
  const rows = await prisma.$queryRaw<
    { merchant: string; total: Prisma.Decimal; cnt: bigint; last: Date; prev: Prisma.Decimal | null }[]
  >`
    SELECT MIN(TRIM(t."merchant")) AS merchant,
      SUM(CASE WHEN t."type"::text = 'REFUND' THEN -t."amount" ELSE t."amount" END)
        FILTER (WHERE t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date) AS total,
      COUNT(*) FILTER (WHERE t."type"::text = 'EXPENSE' AND t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date) AS cnt,
      MAX(t."transactionDate") FILTER (WHERE t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date) AS last,
      SUM(CASE WHEN t."type"::text = 'REFUND' THEN -t."amount" ELSE t."amount" END) FILTER (WHERE ${prevFilter}) AS prev
    FROM "Transaction" t
    WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
      AND t."type"::text IN ('EXPENSE', 'REFUND') AND t."merchant" IS NOT NULL AND TRIM(t."merchant") <> ''
    GROUP BY LOWER(TRIM(t."merchant"))
    HAVING COUNT(*) FILTER (WHERE t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date) > 0
    ORDER BY total DESC NULLS LAST
    LIMIT ${limit}`;
  return rows.map((r) => {
    const total = round2(Number(r.total ?? 0));
    const count = Number(r.cnt);
    const previousTotal = round2(Number(r.prev ?? 0));
    return {
      merchant: r.merchant,
      total,
      count,
      average: count ? round2(total / count) : 0,
      lastDate: fromDbDate(r.last),
      previousTotal,
      changePct: previous ? percentChange(previousTotal, total) : null,
    };
  });
}
