import { prisma } from "@/lib/db/prisma";
import { addDays, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";
import type { RangePreset } from "@/lib/validation/schemas";
import { getFinancialSummary, type FinancialSummary } from "@/server/analytics/summary";
import { getCategoryBreakdown, type CategoryAnalysis } from "@/server/analytics/categories";
import { getMonthlyTrend, type TrendPoint } from "@/server/analytics/trends";
import { getBudgetStatuses, type BudgetStatus } from "@/server/analytics/budget-status";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getBalanceSummary, type BalanceSummary } from "@/server/services/account.service";
import { unreadNotificationCount } from "@/server/services/notification.service";
import { listGoals, type GoalStatus } from "@/server/services/goal.service";
import { listRecurring, listScheduledItems, type ScheduledItem } from "@/server/services/recurring.service";
import { mapTransaction, TX_INCLUDE } from "@/server/services/transaction.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";
import type { TransactionDTO } from "@/server/services/transaction.types";

export interface DashboardData {
  today: ISODate;
  balances: BalanceSummary;
  summary: FinancialSummary;
  categoryBreakdown: CategoryAnalysis[];
  monthlyTrend: TrendPoint[];
  budgets: BudgetStatus[];
  goals: GoalStatus[];
  recentTransactions: TransactionDTO[];
  upcoming: ScheduledItem[];
  subscriptions: { count: number; monthlyTotal: number; annualTotal: number };
  counts: { accounts: number; transactions: number; uncategorized: number; planned: number; unreadNotifications: number };
  hasAnyData: boolean;
}

/**
 * One read-only response for the dashboard. It performs NO writes: recurring
 * processing and reminders run in the scheduler (cron or POST /api/system/sync).
 */
export async function getDashboardData(userId: string, preset: RangePreset = "this_month"): Promise<DashboardData> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const period = resolvePeriod(preset, today, settings);

  const [balances, summary, categoryBreakdown, monthlyTrend, budgets, goals, recentRaw, upcoming, subscriptions, counts, unread] =
    await Promise.all([
      getBalanceSummary(userId),
      getFinancialSummary(userId, period),
      getCategoryBreakdown(userId, period.range, period.previous, "EXPENSE"),
      getMonthlyTrend(userId, today, 6, settings),
      getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn }),
      listGoals(userId, today),
      prisma.transaction.findMany({
        where: { userId, deletedAt: null },
        include: TX_INCLUDE,
        orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
        take: 8,
      }),
      listScheduledItems(userId, addDays(today, -60), addDays(today, 31)),
      listRecurring(userId, { kind: "SUBSCRIPTION", includeInactive: false, today }),
      prisma.$queryRaw<{ accounts: bigint; transactions: bigint; uncategorized: bigint; planned: bigint }[]>`
        SELECT
          (SELECT COUNT(*) FROM "Account" a WHERE a."userId" = ${userId}) AS accounts,
          (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL) AS transactions,
          (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
             AND t."categoryId" IS NULL AND t."isSplit" = false AND t."type"::text IN ('EXPENSE', 'INCOME')) AS uncategorized,
          (SELECT COUNT(*) FROM "Transaction" t WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
             AND t."status" = 'PLANNED') AS planned`,
      unreadNotificationCount(userId),
    ]);

  const c = counts[0];
  const upcomingOpen = upcoming.filter(
    (i) => (i.status === "EXPECTED" || i.status === "DUE" || i.status === "SCHEDULED" || i.status === "FAILED") &&
      (i.date >= today || i.status === "DUE" || i.status === "FAILED")
  );
  return {
    today,
    balances,
    summary,
    categoryBreakdown,
    monthlyTrend,
    budgets: budgets.filter((b) => b.cycle.state === "active"),
    goals,
    recentTransactions: recentRaw.map((t) => mapTransaction(t)),
    upcoming: upcomingOpen.slice(0, 12),
    subscriptions: {
      count: subscriptions.length,
      monthlyTotal: round2(subscriptions.reduce((a, s) => a + s.monthlyEquivalent, 0)),
      annualTotal: round2(subscriptions.reduce((a, s) => a + s.annualEquivalent, 0)),
    },
    counts: {
      accounts: Number(c?.accounts ?? 0),
      transactions: Number(c?.transactions ?? 0),
      uncategorized: Number(c?.uncategorized ?? 0),
      planned: Number(c?.planned ?? 0),
      unreadNotifications: unread,
    },
    hasAnyData: Number(c?.transactions ?? 0) > 0,
  };
}
