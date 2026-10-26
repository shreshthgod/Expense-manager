import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { addDays, dayOfWeek, diffDays, fromDbDate, minISO, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { mean, percentChange, percentageOf, round2, stdDeviation } from "@/lib/utils/money";
import { SPEND_SIGN } from "@/server/analytics/definitions";
import { allocations } from "@/server/analytics/allocations";

/**
 * Analytics 2.0 — all figures use net spending (expenses − refunds) from the
 * category allocations (splits counted once, per line).
 */

export interface SpendingStructure {
  total: number;
  essential: number;
  discretionary: number;
  unclassifiedClass: number;
  fixed: number;
  variable: number;
  unclassifiedBehavior: number;
  essentialPct: number;
  fixedPct: number;
}

export async function getSpendingStructure(userId: string, range: DateRange): Promise<SpendingStructure> {
  const rows = await prisma.$queryRaw<{ cls: string | null; beh: string | null; total: Prisma.Decimal }[]>`
    SELECT c."spendingClass"::text AS cls, c."costBehavior"::text AS beh, SUM(${SPEND_SIGN} * t."amount") AS total
    FROM (${allocations(userId)}) t
    LEFT JOIN "Category" c ON c."id" = t."categoryId"
    WHERE t."type"::text IN ('EXPENSE', 'REFUND')
      AND t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date
    GROUP BY 1, 2`;
  const agg = { total: 0, essential: 0, discretionary: 0, unclassifiedClass: 0, fixed: 0, variable: 0, unclassifiedBehavior: 0 };
  for (const r of rows) {
    const v = Number(r.total);
    agg.total += v;
    if (r.cls === "ESSENTIAL") agg.essential += v;
    else if (r.cls === "DISCRETIONARY") agg.discretionary += v;
    else agg.unclassifiedClass += v;
    if (r.beh === "FIXED") agg.fixed += v;
    else if (r.beh === "VARIABLE") agg.variable += v;
    else agg.unclassifiedBehavior += v;
  }
  const r2 = (v: number) => round2(v);
  return {
    total: r2(agg.total),
    essential: r2(agg.essential),
    discretionary: r2(agg.discretionary),
    unclassifiedClass: r2(agg.unclassifiedClass),
    fixed: r2(agg.fixed),
    variable: r2(agg.variable),
    unclassifiedBehavior: r2(agg.unclassifiedBehavior),
    essentialPct: agg.total > 0 ? percentageOf(agg.total, agg.essential) : 0,
    fixedPct: agg.total > 0 ? percentageOf(agg.total, agg.fixed) : 0,
  };
}

export interface CategoryTrend {
  categoryId: string | null;
  name: string;
  color: string | null;
  series: { key: string; total: number }[];
  average: number;
  stdDev: number;
  latest: number;
  /** Latest vs the average of the earlier months. */
  changePct: number | null;
  direction: "up" | "down" | "flat";
}

/** Monthly net spending per category over the given windows (oldest first), in one query. */
export async function getCategoryTrends(userId: string, windows: { key: string; range: DateRange }[], limit = 8): Promise<CategoryTrend[]> {
  if (!windows.length) return [];
  const rows = await prisma.$queryRaw<{ key: string; categoryId: string | null; total: Prisma.Decimal }[]>`
    WITH w AS (
      SELECT * FROM unnest(${windows.map((w) => w.key)}::text[], ${windows.map((w) => w.range.start)}::text[]::date[], ${windows.map((w) => w.range.end)}::text[]::date[]) AS w(key, s, e)
    )
    SELECT w.key, t."categoryId", SUM(${SPEND_SIGN} * t."amount") AS total
    FROM w JOIN (${allocations(userId)}) t
      ON t."type"::text IN ('EXPENSE', 'REFUND') AND t."transactionDate" >= w.s AND t."transactionDate" < w.e
    GROUP BY w.key, t."categoryId"`;
  const ids = [...new Set(rows.map((r) => r.categoryId).filter((x): x is string => !!x))];
  const cats = ids.length ? await prisma.category.findMany({ where: { userId, id: { in: ids } }, select: { id: true, name: true, color: true } }) : [];
  const meta = new Map(cats.map((c) => [c.id, c]));
  const grouped = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = r.categoryId ?? "";
    if (!grouped.has(k)) grouped.set(k, new Map());
    grouped.get(k)!.set(r.key, Number(r.total));
  }
  const trends: CategoryTrend[] = [...grouped.entries()].map(([id, byKey]) => {
    const series = windows.map((w) => ({ key: w.key, total: round2(byKey.get(w.key) ?? 0) }));
    const values = series.map((s) => s.total);
    const earlier = values.slice(0, -1);
    const latest = values[values.length - 1];
    const avgEarlier = earlier.length ? mean(earlier) : 0;
    const changePct = avgEarlier > 0 ? percentChange(avgEarlier, latest) : null;
    return {
      categoryId: id || null,
      name: id ? meta.get(id)?.name ?? "Deleted category" : "Uncategorized",
      color: id ? meta.get(id)?.color ?? null : null,
      series,
      average: round2(mean(values)),
      stdDev: round2(stdDeviation(values)),
      latest,
      changePct,
      direction: changePct == null || Math.abs(changePct) < 10 ? "flat" : changePct > 0 ? "up" : "down",
    };
  });
  return trends.sort((a, b) => b.average - a.average).slice(0, limit);
}

/** Net spending per calendar day plus a day-of-week profile (heatmap). */
export async function getSpendingHeatmap(userId: string, range: DateRange) {
  const rows = await prisma.$queryRaw<{ d: Date; total: Prisma.Decimal; cnt: bigint }[]>`
    SELECT t."transactionDate" AS d, SUM(${SPEND_SIGN} * t."amount") AS total, COUNT(*) FILTER (WHERE t."type"::text = 'EXPENSE') AS cnt
    FROM "Transaction" t
    WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
      AND t."type"::text IN ('EXPENSE', 'REFUND')
      AND t."transactionDate" >= ${range.start}::date AND t."transactionDate" < ${range.end}::date
    GROUP BY t."transactionDate"`;
  const byDate = new Map(rows.map((r) => [fromDbDate(r.d), { total: round2(Number(r.total)), count: Number(r.cnt) }]));
  const days: { date: ISODate; total: number; count: number; weekday: number }[] = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) {
    const v = byDate.get(d) ?? { total: 0, count: 0 };
    days.push({ date: d, ...v, weekday: dayOfWeek(d) });
  }
  const weekdays = Array.from({ length: 7 }, (_, w) => {
    const list = days.filter((d) => d.weekday === w);
    return { weekday: w, average: list.length ? round2(mean(list.map((d) => d.total))) : 0, total: round2(list.reduce((s, d) => s + d.total, 0)) };
  });
  const max = days.reduce((m, d) => Math.max(m, d.total), 0);
  return { days, weekdays, max, noSpendDays: days.filter((d) => d.total <= 0).length };
}

/**
 * Spending velocity: net spending per elapsed day in the current period vs the
 * same number of days at the start of the previous period.
 */
export async function getSpendingVelocity(userId: string, current: DateRange, previous: DateRange, today: ISODate) {
  const elapsedEnd = minISO(addDays(today, 1), current.end);
  const elapsed = Math.max(1, diffDays(current.start, elapsedEnd));
  const prevEnd = minISO(addDays(previous.start, elapsed), previous.end);
  const rows = await prisma.$queryRaw<{ cur: Prisma.Decimal | null; prev: Prisma.Decimal | null }[]>`
    SELECT
      SUM(${SPEND_SIGN} * t."amount") FILTER (WHERE t."transactionDate" >= ${current.start}::date AND t."transactionDate" < ${elapsedEnd}::date) AS cur,
      SUM(${SPEND_SIGN} * t."amount") FILTER (WHERE t."transactionDate" >= ${previous.start}::date AND t."transactionDate" < ${prevEnd}::date) AS prev
    FROM "Transaction" t
    WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL AND t."type"::text IN ('EXPENSE', 'REFUND')`;
  const cur = Number(rows[0]?.cur ?? 0);
  const prev = Number(rows[0]?.prev ?? 0);
  const periodDays = diffDays(current.start, current.end);
  return {
    elapsedDays: elapsed,
    periodDays,
    spentSoFar: round2(cur),
    previousSamePoint: round2(prev),
    perDay: round2(cur / elapsed),
    previousPerDay: round2(prev / elapsed),
    changePct: prev > 0 ? percentChange(prev, cur) : null,
    projected: round2((cur / elapsed) * periodDays),
  };
}
