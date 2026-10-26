import { prisma } from "@/lib/db/prisma";
import { formatMoney } from "@/lib/utils/format";
import { addDays, fromDbDate, toDbDate, type ISODate } from "@/lib/dates/date-only";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { listGoals } from "@/server/services/goal.service";
import { accountsNeedingReconciliation } from "@/server/services/reconciliation.service";
import { reviewPeriod } from "@/server/services/review.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Review inbox: one list of things that need a decision. Every item is
 * derived live from data and disappears when the underlying issue is resolved
 * (nothing is stored, so nothing can go stale). Each item links to the screen
 * where it is fixed.
 */

export type InboxKind =
  | "uncategorized"
  | "planned_past"
  | "bill_due"
  | "bill_failed"
  | "budget_over"
  | "goal_behind"
  | "reconcile"
  | "month_review"
  | "import_pending";

export interface InboxItem {
  key: string;
  kind: InboxKind;
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  count: number;
  amount: number | null;
  href: string;
  action: string;
}

export async function getInbox(userId: string): Promise<{ items: InboxItem[]; total: number }> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const lastMonth = reviewPeriod(today, settings.monthStartDay);
  const [uncategorized, plannedPast, occurrences, budgets, goals, reconcile, snapshot, importJobs, hasLastMonthData] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, deletedAt: null, status: "POSTED", type: { in: ["EXPENSE", "INCOME"] }, categoryId: null, isSplit: false },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId, deletedAt: null, status: "PLANNED", transactionDate: { lte: toDbDate(today) } },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.recurringOccurrence.findMany({
      where: { userId, status: { in: ["DUE", "FAILED"] }, dueDate: { lte: toDbDate(addDays(today, 3)) } },
      include: { recurring: { select: { name: true, merchant: true, kind: true, cancelledAt: true } } },
      orderBy: { dueDate: "asc" },
    }),
    getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn }),
    listGoals(userId, today),
    accountsNeedingReconciliation(userId),
    prisma.financialSnapshot.findUnique({ where: { userId_periodStart: { userId, periodStart: toDbDate(lastMonth.start) } }, select: { reviewedAt: true } }),
    prisma.importJob.findMany({ where: { userId, status: { in: ["PREVIEWED"] } }, select: { id: true, fileName: true }, take: 5 }),
    prisma.transaction.count({ where: { userId, deletedAt: null, transactionDate: { gte: toDbDate(lastMonth.start), lt: toDbDate(lastMonth.end) } } }),
  ]);

  const m = (n: number) => formatMoney(n, settings.currency);
  const items: InboxItem[] = [];
  const active = occurrences.filter((o) => !o.recurring.cancelledAt);
  const failed = active.filter((o) => o.status === "FAILED");
  const due = active.filter((o) => o.status === "DUE");
  for (const o of failed) {
    items.push({
      key: `bill_failed:${o.id}`,
      kind: "bill_failed",
      priority: 1,
      title: `${o.recurring.name ?? o.recurring.merchant ?? "Recurring item"} couldn't be recorded`,
      detail: o.failureReason ?? `Due ${fromDbDate(o.dueDate)}. Record it manually or skip it.`,
      count: 1,
      amount: Number(o.amount),
      href: `/recurring/${o.recurringId}`,
      action: "Resolve",
    });
  }
  for (const o of due) {
    const date = fromDbDate(o.dueDate);
    const overdue = date < today;
    items.push({
      key: `bill_due:${o.id}`,
      kind: "bill_due",
      priority: overdue ? 1 : 2,
      title: `${o.recurring.name ?? o.recurring.merchant ?? "Bill"} ${overdue ? "is overdue" : date === today ? "is due today" : "is due soon"}`,
      detail: `Due ${date}. Mark it paid when the money leaves your account, or skip this one.`,
      count: 1,
      amount: Number(o.amount),
      href: o.recurring.kind === "SUBSCRIPTION" ? "/subscriptions" : "/bills",
      action: "Mark paid",
    });
  }
  if (plannedPast._count > 0) {
    items.push({
      key: "planned_past",
      kind: "planned_past",
      priority: 1,
      title: `${plannedPast._count} planned transaction(s) have reached their date`,
      detail: "Post them if they happened, or edit the date. Planned items don't change balances until posted.",
      count: plannedPast._count,
      amount: Number(plannedPast._sum.amount ?? 0),
      href: "/transactions?status=PLANNED",
      action: "Review",
    });
  }
  if (uncategorized._count > 0) {
    items.push({
      key: "uncategorized",
      kind: "uncategorized",
      priority: 2,
      title: `${uncategorized._count} transaction(s) have no category`,
      detail: "Categorise them so budgets and analytics are accurate. Rules can do it automatically next time.",
      count: uncategorized._count,
      amount: Number(uncategorized._sum.amount ?? 0),
      href: "/transactions?uncategorized=true",
      action: "Categorise",
    });
  }
  for (const b of budgets.filter((x) => x.exceeded)) {
    items.push({
      key: `budget_over:${b.id}:${b.cycle.start}`,
      kind: "budget_over",
      priority: 2,
      title: `${b.name} is over budget`,
      detail: `Spent ${m(b.spent)} of ${m(b.available)} this cycle.`,
      count: 1,
      amount: b.spent - b.available,
      href: `/budgets?focus=${b.id}`,
      action: "Open budget",
    });
  }
  for (const g of goals.filter((x) => x.onTrack === false && !x.completed)) {
    items.push({
      key: `goal_behind:${g.id}`,
      kind: "goal_behind",
      priority: 3,
      title: `${g.name} is behind schedule`,
      detail: g.requiredMonthlySaving != null ? `About ${m(g.requiredMonthlySaving)} a month is needed to reach it by ${g.effectiveDeadline}.` : `Expected ${g.expectedCompletion}, after the deadline.`,
      count: 1,
      amount: g.remainingAmount,
      href: `/goals?focus=${g.id}`,
      action: "Open goal",
    });
  }
  for (const a of reconcile) {
    items.push({
      key: `reconcile:${a.id}`,
      kind: "reconcile",
      priority: 3,
      title: `Reconcile ${a.name}`,
      detail: a.lastReconciledAt ? `Last reconciled ${a.lastReconciledAt}. Compare with your latest statement.` : "Never reconciled. Compare it with your latest statement.",
      count: 1,
      amount: null,
      href: `/accounts/${a.id}?reconcile=1`,
      action: "Reconcile",
    });
  }
  for (const j of importJobs) {
    items.push({
      key: `import:${j.id}`,
      kind: "import_pending",
      priority: 2,
      title: `Import of ${j.fileName} is waiting for confirmation`,
      detail: "Review the rows and confirm, or discard the import.",
      count: 1,
      amount: null,
      href: `/import/${j.id}`,
      action: "Continue",
    });
  }
  if (hasLastMonthData > 0 && !snapshot?.reviewedAt) {
    items.push({
      key: `month_review:${lastMonth.start}`,
      kind: "month_review",
      priority: 3,
      title: "Your monthly review is ready",
      detail: `Look back at the month starting ${lastMonth.start}: what came in, where it went and what changed.`,
      count: 1,
      amount: null,
      href: `/review?periodStart=${lastMonth.start}`,
      action: "Start review",
    });
  }
  items.sort((a, b) => a.priority - b.priority);
  return { items, total: items.length };
}

export type { ISODate };
