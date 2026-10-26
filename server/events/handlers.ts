import { checkGoals } from "@/server/services/goal-deadlines.service";
import { inRange } from "@/lib/dates/date-only";
import { formatMoney } from "@/lib/utils/format";
import { crossedThreshold, getBudgetStatuses } from "@/server/analytics/budget-status";
import { evaluateExpenses } from "@/server/analytics/detect";
import { notify } from "@/server/services/notification.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";
import type { DomainEvents } from "./outbox";

/**
 * Idempotent handlers for outbox events. Each notification carries a dedupe
 * key, so re-running a handler (retry, duplicate delivery) never double-notifies.
 */

async function onTransactionsChanged(userId: string, payload: DomainEvents["transactions.changed"]) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const money = (n: number) => formatMoney(n, settings.currency);

  // Budget thresholds — only for budgets whose CURRENT cycle contains a changed
  // date. Back-dated imports into old cycles never raise stale alerts.
  const statuses = await getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn });
  for (const s of statuses) {
    if (s.cycle.state !== "active") continue;
    const touched = payload.dates.some((d) => inRange(d, s.cycle));
    if (!touched) continue;
    if (s.categoryId && !payload.categoryIds.includes(s.categoryId)) continue;
    const threshold = crossedThreshold(s.utilization, s.exceeded);
    if (!threshold) continue;
    const exceeded = s.exceeded;
    await notify({
      userId,
      type: exceeded ? "BUDGET_EXCEEDED" : "BUDGET_THRESHOLD",
      title: exceeded ? `Budget exceeded: ${s.name}` : threshold === 100 ? `${s.name} budget fully used` : `${s.name} budget at ${threshold}%`,
      message: exceeded
        ? `${money(s.spent)} spent of ${money(s.amount)} — ${money(s.spent - s.amount)} over for ${s.cycle.start} → ${s.cycle.lastDay}.`
        : `${money(s.spent)} of ${money(s.amount)} used (${s.utilization}%) with ${s.daysRemaining} day(s) left in this cycle.`,
      link: `/budgets?focus=${s.id}`,
      dedupeKey: `budget:${s.id}:${s.cycle.start}:${exceeded ? "exceeded" : threshold}`,
      metadata: { budgetId: s.id, utilization: s.utilization, spent: s.spent, amount: s.amount, cycleStart: s.cycle.start },
    });
  }

  // Unusual expenses — screened once per transaction.
  if (payload.newExpenseIds.length) {
    const anomalies = await evaluateExpenses(userId, payload.newExpenseIds, today, money);
    for (const a of anomalies) {
      await notify({
        userId,
        type: "UNUSUAL_TRANSACTION",
        title: `Unusual expense: ${a.merchant ?? a.description ?? a.categoryName ?? "transaction"}`,
        message: `${money(a.amount)} on ${a.transactionDate}. ${a.reason}`,
        link: `/transactions?focus=${a.transactionId}`,
        dedupeKey: `anomaly:${a.transactionId}`,
        metadata: { transactionId: a.transactionId, ratio: a.ratio, typicalAmount: a.typicalAmount, samples: a.samples },
      });
    }
  }
}

async function onReportGenerated(userId: string, payload: DomainEvents["report.generated"]) {
  await notify({
    userId,
    type: "REPORT_GENERATED",
    title: "Report ready",
    message: `${payload.title} is ready to view.`,
    link: `/reports/${payload.reportId}`,
    dedupeKey: `report:${payload.reportId}`,
  });
}

async function onImportCompleted(userId: string, payload: DomainEvents["import.completed"]) {
  await notify({
    userId,
    type: "IMPORT_COMPLETED",
    title: "Import complete",
    message: `${payload.imported} imported, ${payload.skipped} skipped, ${payload.failed} failed.`,
    link: `/import/${payload.importJobId}`,
    dedupeKey: `import:${payload.importJobId}`,
  });
}

/** Milestone/completion notifications (deduped per goal and milestone). */
async function onGoalChanged(userId: string) {
  await checkGoals(userId);
}

export const handlers: { [K in keyof DomainEvents]: (userId: string, payload: DomainEvents[K]) => Promise<void> } = {
  "transactions.changed": onTransactionsChanged,
  "report.generated": onReportGenerated,
  "import.completed": onImportCompleted,
  "goal.changed": onGoalChanged,
};
