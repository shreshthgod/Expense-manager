import { Prisma, type Budget } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { diffDays, fromDbDate, fromDbDateOrNull, lastDayOf, type ISODate } from "@/lib/dates/date-only";
import { budgetCycleAt, cyclesUpTo, type BudgetCycle, type CycleOptions } from "@/lib/finance/cycles";
import { fromMinor, percentageOf, round2, toMinor } from "@/lib/utils/money";
import { SPEND_SIGN } from "@/server/analytics/definitions";
import { allocations } from "@/server/analytics/allocations";

export interface BudgetStatus {
  id: string;
  name: string;
  /** The configured limit per cycle. */
  amount: number;
  period: "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
  startDate: ISODate;
  endDate: ISODate | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  version: number;
  rolloverMode: "NONE" | "POSITIVE_ONLY" | "FULL";
  /**
   * Amount carried in from earlier cycles (rollover). POSITIVE_ONLY carries
   * unused money only; FULL also carries overspending (negative). Looks back at
   * most ROLLOVER_LOOKBACK cycles.
   */
  carryIn: number;
  /** Limit available this cycle = amount + carryIn. Utilization is measured against it. */
  available: number;
  cycle: { start: ISODate; end: ISODate; lastDay: ISODate; index: number; state: BudgetCycle["state"] };
  /** Net spending (expenses − refunds) in the current cycle. */
  spent: number;
  remaining: number;
  /** null when the limit is zero (no meaningful percentage). */
  utilization: number | null;
  exceeded: boolean;
  daysInCycle: number;
  daysElapsed: number;
  daysRemaining: number;
  /** Share of the cycle that has elapsed (0-100). */
  elapsedPct: number;
  /** Straight-line projection of cycle-end spend at the current pace. */
  projectedSpend: number;
  /** Spending faster than time is passing. */
  aheadOfPace: boolean;
}

export interface SpendWindow {
  key: string;
  start: ISODate;
  end: ISODate;
  categoryId: string | null;
}

/** Net spending (expenses − refunds) for many (window, category) pairs in ONE query. */
export async function spendingForWindows(userId: string, windows: SpendWindow[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (windows.length === 0) return out;
  const rows = await prisma.$queryRaw<{ key: string; spent: Prisma.Decimal | null }[]>`
    WITH w AS (
      SELECT * FROM unnest(
        ${windows.map((w) => w.key)}::text[],
        ${windows.map((w) => w.start)}::text[]::date[],
        ${windows.map((w) => w.end)}::text[]::date[],
        ${windows.map((w) => w.categoryId ?? "")}::text[]
      ) AS w(key, s, e, cat)
    )
    SELECT w.key, SUM(${SPEND_SIGN} * t."amount") AS spent
    FROM w
    LEFT JOIN (${allocations(userId)}) t
      ON t."type"::text IN ('EXPENSE', 'REFUND')
     AND t."transactionDate" >= w.s AND t."transactionDate" < w.e
     AND (w.cat = '' OR t."categoryId" = w.cat)
    GROUP BY w.key`;
  for (const r of rows) out.set(r.key, round2(Number(r.spent ?? 0)));
  return out;
}

type BudgetRow = Budget & { category: { name: string; color: string | null } | null };

export function scheduleOf(b: Pick<Budget, "period" | "startDate" | "endDate">) {
  return { period: b.period, startDate: fromDbDate(b.startDate), endDate: fromDbDateOrNull(b.endDate) };
}

export const ROLLOVER_LOOKBACK = 24;

/**
 * Carry-in for the current cycle from the previous cycles' results, oldest
 * first: carry_{k+1} = f(amount + carry_k − spent_k), f = max(0,·) for
 * POSITIVE_ONLY and identity for FULL.
 */
export function computeCarryIn(mode: BudgetStatus["rolloverMode"], amount: number, previousSpends: number[]): number {
  if (mode === "NONE") return 0;
  let carry = 0;
  for (const spent of previousSpends) {
    const left = toMinor(amount) + carry - toMinor(spent);
    carry = mode === "POSITIVE_ONLY" ? Math.max(0, left) : left;
  }
  return fromMinor(carry);
}

export function buildStatus(b: BudgetRow, cycle: BudgetCycle, spent: number, today: ISODate, carryIn = 0): BudgetStatus {
  const limit = Number(b.amount);
  const amount = fromMinor(toMinor(limit) + toMinor(carryIn));
  const daysInCycle = Math.max(1, diffDays(cycle.start, cycle.end));
  const daysElapsed =
    cycle.state === "upcoming" ? 0 : cycle.state === "ended" ? daysInCycle : Math.min(daysInCycle, diffDays(cycle.start, today) + 1);
  const elapsedPct = round2((daysElapsed / daysInCycle) * 100);
  const utilization = amount > 0 ? percentageOf(amount, spent) : null;
  const projectedSpend = daysElapsed > 0 ? round2((spent / daysElapsed) * daysInCycle) : 0;
  return {
    id: b.id,
    name: b.name,
    amount: limit,
    rolloverMode: b.rolloverMode,
    carryIn,
    available: amount,
    period: b.period,
    startDate: fromDbDate(b.startDate),
    endDate: fromDbDateOrNull(b.endDate),
    categoryId: b.categoryId,
    categoryName: b.category?.name ?? null,
    categoryColor: b.category?.color ?? null,
    version: b.version,
    cycle: { start: cycle.start, end: cycle.end, lastDay: lastDayOf(cycle), index: cycle.index, state: cycle.state },
    spent,
    remaining: fromMinor(toMinor(amount) - toMinor(spent)),
    utilization,
    exceeded: spent > amount,
    daysInCycle,
    daysElapsed,
    daysRemaining: Math.max(0, daysInCycle - daysElapsed),
    elapsedPct,
    projectedSpend,
    aheadOfPace: utilization != null && cycle.state === "active" && utilization > elapsedPct + 5,
  };
}

/**
 * Live status of every budget for the cycle that applies today. Budgets whose
 * CUSTOM window or stop date has passed are included only when
 * `includeEnded` is set.
 */
export async function getBudgetStatuses(
  userId: string,
  today: ISODate,
  opts: CycleOptions & { includeEnded?: boolean; budgetIds?: string[] }
): Promise<BudgetStatus[]> {
  const budgets = await prisma.budget.findMany({
    where: { userId, ...(opts.budgetIds ? { id: { in: opts.budgetIds } } : {}) },
    include: { category: { select: { name: true, color: true } } },
    orderBy: [{ createdAt: "asc" }],
  });
  const withCycles = budgets
    .map((b) => ({ b, cycle: budgetCycleAt(scheduleOf(b), today, opts) }))
    .filter(({ cycle }) => opts.includeEnded || cycle.state !== "ended");
  // Previous cycles (for rollover) are fetched in the same single query.
  const history = new Map<string, BudgetCycle[]>();
  for (const { b, cycle } of withCycles) {
    if (b.rolloverMode === "NONE" || b.period === "CUSTOM" || cycle.state === "upcoming") continue;
    const cycles = cyclesUpTo(scheduleOf(b), cycle.start, ROLLOVER_LOOKBACK + 1, opts).filter((c) => c.index < cycle.index);
    history.set(b.id, cycles);
  }
  const spent = await spendingForWindows(userId, [
    ...withCycles.map(({ b, cycle }) => ({ key: b.id, start: cycle.start, end: cycle.end, categoryId: b.categoryId })),
    ...[...history.entries()].flatMap(([id, cycles]) => {
      const categoryId = withCycles.find((w) => w.b.id === id)!.b.categoryId;
      return cycles.map((c) => ({ key: `${id}#${c.index}`, start: c.start, end: c.end, categoryId }));
    }),
  ]);
  return withCycles.map(({ b, cycle }) => {
    const prev = history.get(b.id) ?? [];
    const carryIn = computeCarryIn(b.rolloverMode, Number(b.amount), prev.map((c) => spent.get(`${b.id}#${c.index}`) ?? 0));
    return buildStatus(b, cycle, spent.get(b.id) ?? 0, today, carryIn);
  });
}

/** Highest alert threshold reached by a utilization, or null. */
export function crossedThreshold(utilization: number | null, exceeded = false): 50 | 75 | 90 | 100 | null {
  if (exceeded) return 100;
  if (utilization == null) return null;
  if (utilization >= 100) return 100;
  if (utilization >= 90) return 90;
  if (utilization >= 75) return 75;
  if (utilization >= 50) return 50;
  return null;
}
