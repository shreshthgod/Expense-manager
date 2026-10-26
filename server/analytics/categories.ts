import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { minISO, maxISO, type DateRange } from "@/lib/dates/date-only";
import { percentChange, percentageOf, round2 } from "@/lib/utils/money";
import { SPEND_SIGN } from "@/server/analytics/definitions";
import { allocations } from "@/server/analytics/allocations";

export interface CategoryAnalysis {
  categoryId: string | null;
  name: string;
  color: string | null;
  icon: string | null;
  spendingClass: "ESSENTIAL" | "DISCRETIONARY" | null;
  costBehavior: "FIXED" | "VARIABLE" | null;
  /** Net amount (expenses − refunds for spending; income for income). */
  total: number;
  gross: number;
  refunds: number;
  /** Share of the period total (net). */
  percentage: number;
  count: number;
  averageTransaction: number;
  previousTotal: number;
  changePct: number | null;
}

/**
 * Per-category totals for `range` and its comparison period in one query.
 * kind = EXPENSE → net spending (expenses minus refunds, allocated to the
 * refund's category and posting date); kind = INCOME → income by source.
 */
export async function getCategoryBreakdown(
  userId: string,
  range: DateRange,
  previous: DateRange,
  kind: "EXPENSE" | "INCOME" = "EXPENSE"
): Promise<CategoryAnalysis[]> {
  const lo = minISO(range.start, previous.start);
  const hi = maxISO(range.end, previous.end);
  const sign = kind === "EXPENSE" ? SPEND_SIGN : Prisma.sql`1`;
  const types = kind === "EXPENSE" ? ["EXPENSE", "REFUND"] : ["INCOME"];
  const inCur = Prisma.sql`t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date`;
  const inPrev = Prisma.sql`t."transactionDate" >= ${previous.start}::date AND t."transactionDate" < ${previous.end}::date`;

  const rows = await prisma.$queryRaw<
    { categoryId: string | null; cur: Prisma.Decimal | null; gross: Prisma.Decimal | null; refunds: Prisma.Decimal | null; cnt: bigint; prev: Prisma.Decimal | null }[]
  >`
    SELECT t."categoryId" AS "categoryId",
      SUM(${sign} * t."amount") FILTER (WHERE ${inCur}) AS cur,
      SUM(t."amount") FILTER (WHERE ${inCur} AND t."type"::text <> 'REFUND') AS gross,
      SUM(t."amount") FILTER (WHERE ${inCur} AND t."type"::text = 'REFUND') AS refunds,
      COUNT(DISTINCT t."id") FILTER (WHERE ${inCur} AND t."type"::text <> 'REFUND') AS cnt,
      SUM(${sign} * t."amount") FILTER (WHERE ${inPrev}) AS prev
    FROM (${allocations(userId)}) t
    WHERE t."type"::text IN (${Prisma.join(types)})
      AND t."transactionDate" >= ${lo}::date AND t."transactionDate" < ${hi}::date
    GROUP BY t."categoryId"`;

  const ids = rows.map((r) => r.categoryId).filter((v): v is string => v != null);
  const categories = ids.length
    ? await prisma.category.findMany({ where: { userId, id: { in: ids } } })
    : [];
  const byId = new Map(categories.map((c) => [c.id, c]));

  const current = rows.map((r) => Number(r.cur ?? 0));
  const grand = current.reduce((a, b) => a + b, 0);

  return rows
    .map((r) => {
      const c = r.categoryId ? byId.get(r.categoryId) : undefined;
      const total = round2(Number(r.cur ?? 0));
      const count = Number(r.cnt);
      const previousTotal = round2(Number(r.prev ?? 0));
      return {
        categoryId: r.categoryId,
        name: c?.name ?? "Uncategorized",
        color: c?.color ?? null,
        icon: c?.icon ?? null,
        spendingClass: c?.spendingClass ?? null,
        costBehavior: c?.costBehavior ?? null,
        total,
        gross: round2(Number(r.gross ?? 0)),
        refunds: round2(Number(r.refunds ?? 0)),
        percentage: percentageOf(grand, total),
        count,
        averageTransaction: round2(count > 0 ? Number(r.gross ?? 0) / count : 0),
        previousTotal,
        changePct: percentChange(previousTotal, total),
      };
    })
    .filter((c) => c.total !== 0 || c.previousTotal !== 0)
    .sort((a, b) => b.total - a.total);
}
