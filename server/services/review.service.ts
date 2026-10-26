import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, financialMonthOf, fromDbDate, lastDayOf, previousRangeOf, toDbDate, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { formatMoney } from "@/lib/utils/format";
import { fromMinor, round2, toMinor } from "@/lib/utils/money";
import { compareTotals, totalsForRange, type PeriodTotals } from "@/server/analytics/definitions";
import { getCategoryBreakdown } from "@/server/analytics/categories";
import { getTopMerchants } from "@/server/analytics/merchants";
import { detectAnomaliesInRange } from "@/server/analytics/detect";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { calculateHealthScore } from "@/server/analytics/health-score";
import { netWorthAt } from "@/server/services/planning.service";
import { getUserSettings, todayFor, type UserSettings } from "@/server/services/user-settings.service";
import { logger } from "@/lib/observability/logger";

/**
 * Monthly review: a guided look back at one completed financial month —
 * totals vs the month before, categories, budgets, merchants, bills, goals,
 * net worth and unusual expenses. Marking the month reviewed stores a
 * FinancialSnapshot so the history stays stable even if categories or settings
 * change later; if live numbers later differ from the snapshot (a back-dated
 * edit), the review says so.
 */

export interface MonthlyReview {
  period: DateRange & { lastDay: ISODate; label: string };
  previousPeriod: DateRange;
  complete: boolean;
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  comparison: ReturnType<typeof compareTotals>;
  categories: Awaited<ReturnType<typeof getCategoryBreakdown>>;
  merchants: Awaited<ReturnType<typeof getTopMerchants>>;
  budgets: { id: string; name: string; available: number; spent: number; exceeded: boolean; utilization: number | null }[];
  bills: { paid: number; skipped: number; missed: number; missedItems: { name: string; dueDate: ISODate; amount: number }[] };
  goals: { id: string; name: string; contributed: number; currentAmount: number; targetAmount: number }[];
  netWorth: { start: number; end: number; change: number };
  anomalies: Awaited<ReturnType<typeof detectAnomaliesInRange>>;
  highlights: string[];
  snapshot: { reviewedAt: string | null; notes: string | null; changedSinceReview: boolean; snapshotNetSpending: number | null } | null;
}

function monthLabel(range: DateRange): string {
  const d = new Date(`${range.start}T00:00:00Z`);
  const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return range.start.endsWith("-01") ? label : `${label} (from ${range.start})`;
}

/** The financial month containing `periodStart`, defaulting to the last completed one. */
export function reviewPeriod(today: ISODate, monthStartDay: number, periodStart?: ISODate): DateRange {
  if (periodStart) return financialMonthOf(periodStart, monthStartDay);
  const current = financialMonthOf(today, monthStartDay);
  return financialMonthOf(addDays(current.start, -1), monthStartDay);
}

export async function getMonthlyReview(userId: string, periodStart?: ISODate): Promise<MonthlyReview> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const period = reviewPeriod(today, settings.monthStartDay, periodStart);
  if (period.start > today) throw ApiError.field("periodStart", "That month hasn't started yet");
  const previous = previousRangeOf(period);
  const lastDay = lastDayOf(period);
  const money = (n: number) => formatMoney(n, settings.currency);

  const [totals, previousTotals, categories, merchants, budgets, occurrences, goals, contributions, nw, anomalies, snapshot] = await Promise.all([
    totalsForRange(userId, period),
    totalsForRange(userId, previous),
    getCategoryBreakdown(userId, period, previous),
    getTopMerchants(userId, period, previous, 8),
    getBudgetStatuses(userId, lastDay < today ? lastDay : today, { weekStartsOn: settings.weekStartsOn, includeEnded: true }),
    prisma.recurringOccurrence.findMany({
      where: { userId, dueDate: { gte: toDbDate(period.start), lt: toDbDate(period.end) } },
      include: { recurring: { select: { name: true, merchant: true, kind: true, type: true } } },
    }),
    prisma.savingsGoal.findMany({ where: { userId }, select: { id: true, name: true, currentAmount: true, targetAmount: true } }),
    prisma.goalContribution.groupBy({
      by: ["goalId"],
      where: { userId, date: { gte: toDbDate(period.start), lt: toDbDate(period.end) } },
      _sum: { amount: true },
    }),
    netWorthAt(userId, [addDays(period.start, -1), lastDay < today ? lastDay : today]),
    detectAnomaliesInRange(userId, period, (n) => formatMoney(n, settings.currency)),
    prisma.financialSnapshot.findUnique({ where: { userId_periodStart: { userId, periodStart: toDbDate(period.start) } } }),
  ]);

  const outflowOccurrences = occurrences.filter((o) => o.recurring.type !== "INCOME");
  const missedItems = outflowOccurrences
    .filter((o) => o.status === "DUE" || o.status === "FAILED" || (o.status === "SCHEDULED" && fromDbDate(o.dueDate) < today))
    .map((o) => ({ name: o.recurring.name ?? o.recurring.merchant ?? "Bill", dueDate: fromDbDate(o.dueDate), amount: Number(o.amount) }));
  const contributed = new Map(contributions.map((c) => [c.goalId, Number(c._sum.amount ?? 0)]));
  const budgetRows = budgets
    .filter((b) => b.cycle.start < period.end && b.cycle.end > period.start)
    .map((b) => ({ id: b.id, name: b.name, available: b.available, spent: b.spent, exceeded: b.exceeded, utilization: b.utilization }));

  const comparison = compareTotals(totals, previousTotals);
  const highlights: string[] = [];
  if (totals.transactionCount === 0) highlights.push("No income or spending was recorded in this month.");
  else {
    highlights.push(
      totals.surplus >= 0
        ? `You kept ${money(totals.surplus)} of ${money(totals.income)} income${totals.savingsRate != null ? ` (${totals.savingsRate}%)` : ""}.`
        : `Spending exceeded income by ${money(-totals.surplus)}.`
    );
    const top = categories[0];
    if (top) highlights.push(`${top.name} was the largest category at ${money(top.total)} (${top.percentage}% of spending).`);
    const riser = [...categories].filter((c) => c.changePct != null && c.previousTotal > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0))[0];
    if (riser && (riser.changePct ?? 0) >= 20) highlights.push(`${riser.name} rose ${riser.changePct}% versus the month before.`);
    const over = budgetRows.filter((b) => b.exceeded);
    if (over.length) highlights.push(`${over.length} budget(s) went over: ${over.map((b) => b.name).join(", ")}.`);
    if (missedItems.length) highlights.push(`${missedItems.length} bill(s) were not marked paid.`);
  }

  const snapshotNet = snapshot ? Number(snapshot.netSpending) : null;
  return {
    period: { ...period, lastDay, label: monthLabel(period) },
    previousPeriod: previous,
    complete: period.end <= today,
    totals,
    previousTotals,
    comparison,
    categories,
    merchants,
    budgets: budgetRows,
    bills: {
      paid: outflowOccurrences.filter((o) => o.status === "RECORDED").length,
      skipped: outflowOccurrences.filter((o) => o.status === "SKIPPED").length,
      missed: missedItems.length,
      missedItems,
    },
    goals: goals
      .filter((g) => contributed.has(g.id))
      .map((g) => ({ id: g.id, name: g.name, contributed: round2(contributed.get(g.id) ?? 0), currentAmount: Number(g.currentAmount), targetAmount: Number(g.targetAmount) })),
    netWorth: { start: nw[0].netWorth, end: nw[1].netWorth, change: fromMinor(toMinor(nw[1].netWorth) - toMinor(nw[0].netWorth)) },
    anomalies,
    highlights,
    snapshot: snapshot
      ? {
          reviewedAt: snapshot.reviewedAt?.toISOString() ?? null,
          notes: snapshot.notes,
          changedSinceReview: snapshotNet != null && toMinor(snapshotNet) !== toMinor(totals.netSpending),
          snapshotNetSpending: snapshotNet,
        }
      : null,
  };
}

/** Stores (or refreshes) the snapshot for a financial month. */
export async function captureSnapshot(userId: string, period: DateRange, opts: { reviewed?: boolean; notes?: string | null; settings?: UserSettings } = {}) {
  const settings = opts.settings ?? (await getUserSettings(userId));
  const today = todayFor(settings);
  const lastDay = lastDayOf(period);
  const asOf = lastDay < today ? lastDay : today;
  const [totals, [nw], health] = await Promise.all([
    totalsForRange(userId, period),
    netWorthAt(userId, [asOf]),
    calculateHealthScore(userId, asOf, settings).catch(() => null),
  ]);
  const categories = await getCategoryBreakdown(userId, period, previousRangeOf(period));
  const data = {
    totals,
    categories: categories.map((c) => ({ categoryId: c.categoryId, name: c.name, total: c.total })),
    healthScore: health ? { score: health.score, grade: health.grade, formulaVersion: health.formulaVersion } : null,
    capturedFor: asOf,
  };
  const values = {
    periodEnd: toDbDate(period.end),
    assets: new Prisma.Decimal(nw.assets.toFixed(2)),
    liabilities: new Prisma.Decimal(nw.liabilities.toFixed(2)),
    netWorth: new Prisma.Decimal(nw.netWorth.toFixed(2)),
    liquid: new Prisma.Decimal(nw.liquid.toFixed(2)),
    income: new Prisma.Decimal(totals.income.toFixed(2)),
    netSpending: new Prisma.Decimal(totals.netSpending.toFixed(2)),
    surplus: new Prisma.Decimal(totals.surplus.toFixed(2)),
    data: data as unknown as Prisma.InputJsonValue,
    ...(opts.reviewed ? { reviewedAt: new Date() } : {}),
    ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
  };
  return prisma.financialSnapshot.upsert({
    where: { userId_periodStart: { userId, periodStart: toDbDate(period.start) } },
    create: { userId, periodStart: toDbDate(period.start), ...values },
    update: values,
  });
}

export async function markMonthReviewed(userId: string, input: { periodStart: ISODate; notes?: string | null }) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const period = financialMonthOf(input.periodStart, settings.monthStartDay);
  if (period.start > today) throw ApiError.field("periodStart", "That month hasn't started yet");
  await captureSnapshot(userId, period, { reviewed: true, notes: input.notes ?? null, settings });
  return getMonthlyReview(userId, period.start);
}

export async function listSnapshots(userId: string, limit = 24) {
  const rows = await prisma.financialSnapshot.findMany({ where: { userId }, orderBy: { periodStart: "desc" }, take: limit });
  return rows.map((s) => {
    const data = (s.data ?? {}) as { healthScore?: { score: number; grade: string } | null };
    return {
      periodStart: fromDbDate(s.periodStart),
      periodEnd: fromDbDate(s.periodEnd),
      netWorth: Number(s.netWorth),
      liquid: Number(s.liquid),
      income: Number(s.income),
      netSpending: Number(s.netSpending),
      surplus: Number(s.surplus),
      healthScore: data.healthScore ?? null,
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
    };
  });
}

/**
 * Scheduler job: snapshots the most recent completed financial month for
 * every user who doesn't have one yet (idempotent via unique(userId, periodStart)).
 */
export async function captureDueSnapshots(userId?: string): Promise<number> {
  const users = userId ? [{ id: userId }] : await prisma.user.findMany({ select: { id: true } });
  let captured = 0;
  for (const { id } of users) {
    try {
      const settings = await getUserSettings(id);
      const period = reviewPeriod(todayFor(settings), settings.monthStartDay);
      const exists = await prisma.financialSnapshot.findUnique({ where: { userId_periodStart: { userId: id, periodStart: toDbDate(period.start) } }, select: { id: true } });
      if (exists) continue;
      const hasData = await prisma.transaction.count({ where: { userId: id, deletedAt: null, transactionDate: { lt: toDbDate(period.end) } } });
      if (!hasData) continue;
      await captureSnapshot(id, period, { settings });
      captured += 1;
    } catch (error) {
      logger.error("snapshot.capture_failed", { userId: id, error });
    }
  }
  return captured;
}
