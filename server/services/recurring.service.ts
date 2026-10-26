import { Prisma, type OccurrenceStatus, type RecurringKind, type RecurringOccurrence, type RecurringTransaction, type TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, diffDays, fromDbDate, fromDbDateOrNull, toDbDate, type ISODate } from "@/lib/dates/date-only";
import {
  annualEquivalent,
  monthlyEquivalent,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
  type RecurrenceRule,
} from "@/lib/finance/recurrence";
import { round2 } from "@/lib/utils/money";
import { formatMoney } from "@/lib/utils/format";
import { logger } from "@/lib/observability/logger";
import {
  recurringShapeIssues,
  type RecurringCreateInput,
  type RecurringUpdateInput,
} from "@/lib/validation/schemas";
import { runInTransaction, type IdempotencyContext, type TxClient } from "@/server/db/idempotency";
import { applyEffects, ledgerEffects } from "@/server/ledger/effects";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { requireOwnedAccounts, requireOwnedCategory } from "@/server/services/ownership";
import { auditTx } from "@/server/services/audit.service";
import { notify } from "@/server/services/notification.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/** Occurrences materialised per rule per run (bounded catch-up after downtime). */
export const MAX_CATCH_UP = 12;

export type BillState = "UPCOMING" | "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "PAID" | "PAUSED" | "CANCELLED" | "ENDED";

export interface OccurrenceDTO {
  id: string | null;
  dueDate: ISODate;
  amount: number;
  status: OccurrenceStatus | "EXPECTED";
  transactionId: string | null;
  failureReason: string | null;
}

export interface RecurringDTO {
  id: string;
  kind: RecurringKind;
  name: string;
  type: TransactionType;
  amount: number;
  accountId: string | null;
  accountName: string | null;
  destinationAccountId: string | null;
  destinationAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  merchant: string | null;
  description: string | null;
  notes: string | null;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  startDate: ISODate;
  endDate: ISODate | null;
  nextDueDate: ISODate | null;
  active: boolean;
  cancelled: boolean;
  autoCreate: boolean;
  autopay: boolean;
  reminderDaysBefore: number;
  lastExecutedAt: string | null;
  version: number;
  monthlyEquivalent: number;
  annualEquivalent: number;
  state: BillState;
  /** Oldest unpaid occurrence (DUE/FAILED), if any. */
  outstanding: OccurrenceDTO | null;
  upcoming: ISODate[];
}

type RuleRow = RecurringTransaction & {
  account: { name: string } | null;
  destinationAccount: { name: string } | null;
  category: { name: string; color: string | null } | null;
  occurrences: RecurringOccurrence[];
};

const RULE_INCLUDE = {
  account: { select: { name: true } },
  destinationAccount: { select: { name: true } },
  category: { select: { name: true, color: true } },
  occurrences: { orderBy: { dueDate: "desc" }, take: 24 },
} satisfies Prisma.RecurringTransactionInclude;

export function ruleOf(r: Pick<RecurringTransaction, "startDate" | "frequency" | "interval" | "endDate">): RecurrenceRule {
  return {
    anchorDate: fromDbDate(r.startDate),
    frequency: r.frequency,
    interval: r.interval,
    endDate: fromDbDateOrNull(r.endDate),
  };
}

function occurrenceDTO(o: RecurringOccurrence): OccurrenceDTO {
  return {
    id: o.id,
    dueDate: fromDbDate(o.dueDate),
    amount: Number(o.amount),
    status: o.status,
    transactionId: o.status === "RECORDED" ? o.transactionId : null,
    failureReason: o.failureReason,
  };
}

export function deriveState(r: RuleRow, today: ISODate): { state: BillState; outstanding: OccurrenceDTO | null; nextDueDate: ISODate | null } {
  const unpaid = r.occurrences
    .filter((o) => o.status === "DUE" || o.status === "FAILED")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
  const outstanding = unpaid ? occurrenceDTO(unpaid) : null;
  const rule = ruleOf(r);
  const cursor = fromDbDate(r.nextExecutionDate);
  const nextScheduled = rule.endDate && cursor > rule.endDate ? null : cursor;
  const nextDueDate = outstanding?.dueDate ?? nextScheduled;

  if (r.cancelledAt) return { state: "CANCELLED", outstanding, nextDueDate: outstanding?.dueDate ?? null };
  if (outstanding) {
    const d = diffDays(today, outstanding.dueDate);
    return { state: d < 0 ? "OVERDUE" : d === 0 ? "DUE_TODAY" : "DUE_SOON", outstanding, nextDueDate };
  }
  if (!r.active) return { state: "PAUSED", outstanding, nextDueDate };
  if (!nextScheduled) return { state: "ENDED", outstanding, nextDueDate: null };
  const days = diffDays(today, nextScheduled);
  const lastRecorded = r.occurrences.find((o) => o.status === "RECORDED");
  if (days === 0) return { state: "DUE_TODAY", outstanding, nextDueDate };
  if (days <= r.reminderDaysBefore) return { state: "DUE_SOON", outstanding, nextDueDate };
  if (lastRecorded) return { state: "PAID", outstanding, nextDueDate };
  return { state: "UPCOMING", outstanding, nextDueDate };
}

export function toRecurringDTO(r: RuleRow, today: ISODate): RecurringDTO {
  const amount = Number(r.amount);
  const derived = deriveState(r, today);
  const rule = ruleOf(r);
  const cursor = fromDbDate(r.nextExecutionDate);
  return {
    id: r.id,
    kind: r.kind,
    name: r.name ?? r.merchant ?? r.description ?? "Recurring item",
    type: r.type,
    amount,
    accountId: r.accountId,
    accountName: r.account?.name ?? null,
    destinationAccountId: r.destinationAccountId,
    destinationAccountName: r.destinationAccount?.name ?? null,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    categoryColor: r.category?.color ?? null,
    merchant: r.merchant,
    description: r.description,
    notes: r.notes,
    frequency: r.frequency,
    interval: r.interval,
    startDate: rule.anchorDate,
    endDate: rule.endDate ?? null,
    nextDueDate: derived.nextDueDate,
    active: r.active,
    cancelled: r.cancelledAt != null,
    autoCreate: r.autoCreate,
    autopay: r.autopay,
    reminderDaysBefore: r.reminderDaysBefore,
    lastExecutedAt: r.lastExecutedAt?.toISOString() ?? null,
    version: r.version,
    monthlyEquivalent: round2(monthlyEquivalent(amount, r.frequency, r.interval)),
    annualEquivalent: round2(annualEquivalent(amount, r.frequency, r.interval)),
    state: derived.state,
    outstanding: derived.outstanding,
    upcoming: r.active && !r.cancelledAt ? occurrencesBetween(rule, cursor, addDays(cursor, 400), 3) : [],
  };
}

export async function listRecurring(
  userId: string,
  opts: { kind?: RecurringKind; includeInactive?: boolean; today?: ISODate } = {}
): Promise<RecurringDTO[]> {
  const today = opts.today ?? todayFor(await getUserSettings(userId));
  const rows = await prisma.recurringTransaction.findMany({
    where: {
      userId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.includeInactive === false ? { active: true, cancelledAt: null } : {}),
    },
    include: RULE_INCLUDE,
    orderBy: [{ nextExecutionDate: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => toRecurringDTO(r, today));
}

export async function getRecurring(userId: string, id: string) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const row = await prisma.recurringTransaction.findFirst({ where: { id, userId }, include: RULE_INCLUDE });
  if (!row) throw ApiError.notFound("Recurring item not found");
  return {
    ...toRecurringDTO(row, today),
    history: row.occurrences.map(occurrenceDTO),
    preview: occurrencesBetween(ruleOf(row), fromDbDate(row.nextExecutionDate), addDays(today, 800), 6),
  };
}

async function validateRule(
  tx: TxClient,
  userId: string,
  v: {
    kind: string;
    type: "EXPENSE" | "INCOME" | "TRANSFER";
    accountId: string | null;
    destinationAccountId: string | null;
    categoryId: string | null;
    startDate: ISODate;
    endDate: ISODate | null;
  },
  previous?: { accountId: string | null; destinationAccountId: string | null; categoryId: string | null }
) {
  const issues = recurringShapeIssues(v);
  if (issues.length) throw ApiError.validation(issues);
  await requireOwnedAccounts(tx, userId, [
    { path: "accountId", id: v.accountId, allowArchived: previous?.accountId === v.accountId },
    { path: "destinationAccountId", id: v.destinationAccountId, allowArchived: previous?.destinationAccountId === v.destinationAccountId },
  ]);
  if (v.type !== "TRANSFER") {
    await requireOwnedCategory(tx, userId, v.categoryId, v.type, { allowArchived: previous?.categoryId === v.categoryId });
  }
}

/**
 * New rules never back-fill the past: the first occurrence generated is the
 * first schedule date on or after today. (Past history belongs in imports.)
 */
function initialCursor(rule: RecurrenceRule, today: ISODate): ISODate {
  return nextOccurrenceOnOrAfter(rule, today) ?? addDays(rule.endDate ?? today, 1);
}

export async function createRecurring(userId: string, input: RecurringCreateInput, opts: { idempotency?: IdempotencyContext } = {}) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    const next = {
      kind: input.kind,
      type: input.type,
      accountId: input.accountId,
      destinationAccountId: input.destinationAccountId ?? null,
      categoryId: input.type === "TRANSFER" ? null : (input.categoryId ?? null),
      startDate: input.startDate,
      endDate: input.endDate ?? null,
    };
    await validateRule(tx, userId, next);
    const rule: RecurrenceRule = { anchorDate: input.startDate, frequency: input.frequency, interval: input.interval, endDate: next.endDate };
    const row = await tx.recurringTransaction.create({
      data: {
        userId,
        kind: input.kind,
        name: input.name,
        type: input.type,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        accountId: next.accountId,
        destinationAccountId: next.destinationAccountId,
        categoryId: next.categoryId,
        merchant: input.merchant ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        frequency: input.frequency,
        interval: input.interval,
        startDate: toDbDate(input.startDate),
        nextExecutionDate: toDbDate(initialCursor(rule, today)),
        endDate: next.endDate ? toDbDate(next.endDate) : null,
        autoCreate: input.autoCreate,
        autopay: input.autopay,
        reminderDaysBefore: input.reminderDaysBefore,
      },
    });
    await auditTx(tx, { userId, action: "RECURRING_CREATED", entity: "RecurringTransaction", entityId: row.id, metadata: { kind: row.kind } });
    return { id: row.id };
  });
  return { recurring: await getRecurring(userId, result.value.id), replayed: result.replayed };
}

async function lockRule(tx: TxClient, userId: string, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "RecurringTransaction" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
  const rule = await tx.recurringTransaction.findFirst({ where: { id, userId } });
  if (!rule) throw ApiError.notFound("Recurring item not found");
  return rule;
}

/** "This and future" edit: posted history is never touched. */
export async function updateRecurring(userId: string, id: string, input: RecurringUpdateInput) {
  const today = todayFor(await getUserSettings(userId));
  await runInTransaction(userId, undefined, async (tx) => {
    const existing = await lockRule(tx, userId, id);
    if (existing.version !== input.version) throw ApiError.versionConflict("recurring item");
    const has = <K extends keyof RecurringUpdateInput>(k: K) => input[k] !== undefined;
    const type = (input.type ?? existing.type) as "EXPENSE" | "INCOME" | "TRANSFER";
    const merged = {
      kind: existing.kind,
      type,
      accountId: input.accountId ?? existing.accountId,
      destinationAccountId: has("destinationAccountId") ? (input.destinationAccountId ?? null) : existing.destinationAccountId,
      categoryId: type === "TRANSFER" ? null : has("categoryId") ? (input.categoryId ?? null) : existing.categoryId,
      startDate: input.startDate ?? fromDbDate(existing.startDate),
      endDate: has("endDate") ? (input.endDate ?? null) : fromDbDateOrNull(existing.endDate),
    };
    await validateRule(tx, userId, merged, existing);

    const frequency = input.frequency ?? existing.frequency;
    const interval = input.interval ?? existing.interval;
    const scheduleChanged =
      frequency !== existing.frequency || interval !== existing.interval ||
      merged.startDate !== fromDbDate(existing.startDate) || merged.endDate !== fromDbDateOrNull(existing.endDate);
    let nextExecutionDate: Date | undefined;
    if (scheduleChanged) {
      const lastMaterialized = await tx.recurringOccurrence.findFirst({
        where: { recurringId: id, status: { in: ["DUE", "RECORDED", "SKIPPED", "FAILED"] } },
        orderBy: { dueDate: "desc" },
        select: { dueDate: true },
      });
      const from = lastMaterialized ? addDays(fromDbDate(lastMaterialized.dueDate), 1) : today;
      const rule: RecurrenceRule = { anchorDate: merged.startDate, frequency, interval, endDate: merged.endDate };
      nextExecutionDate = toDbDate(initialCursor(rule, from > today ? from : today));
      // Pre-created overrides that no longer fall on the schedule are dropped.
      await tx.recurringOccurrence.deleteMany({ where: { recurringId: id, status: "SCHEDULED" } });
    }

    await tx.recurringTransaction.update({
      where: { id },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        type,
        ...(input.amount != null ? { amount: new Prisma.Decimal(input.amount.toFixed(2)) } : {}),
        accountId: merged.accountId,
        destinationAccountId: merged.destinationAccountId,
        categoryId: merged.categoryId,
        ...(has("merchant") ? { merchant: input.merchant ?? null } : {}),
        ...(has("description") ? { description: input.description ?? null } : {}),
        ...(has("notes") ? { notes: input.notes ?? null } : {}),
        frequency,
        interval,
        startDate: toDbDate(merged.startDate),
        endDate: merged.endDate ? toDbDate(merged.endDate) : null,
        ...(nextExecutionDate ? { nextExecutionDate } : {}),
        ...(input.autoCreate !== undefined ? { autoCreate: input.autoCreate } : {}),
        ...(input.autopay !== undefined ? { autopay: input.autopay } : {}),
        ...(input.reminderDaysBefore !== undefined ? { reminderDaysBefore: input.reminderDaysBefore } : {}),
        version: { increment: 1 },
      },
    });
    await auditTx(tx, { userId, action: "RECURRING_UPDATED", entity: "RecurringTransaction", entityId: id });
  });
  return getRecurring(userId, id);
}

export async function changeRecurringState(
  userId: string,
  id: string,
  input: { action: "pause" | "resume" | "cancel"; version: number; missed?: "skip" | "record" }
) {
  const today = todayFor(await getUserSettings(userId));
  await runInTransaction(userId, undefined, async (tx) => {
    const rule = await lockRule(tx, userId, id);
    if (rule.version !== input.version) throw ApiError.versionConflict("recurring item");
    if (rule.cancelledAt && input.action !== "cancel") {
      throw ApiError.rule("This item was cancelled. Create a new one to start it again.", "RECURRING_CANCELLED");
    }
    const data: Prisma.RecurringTransactionUpdateInput = { version: { increment: 1 } };
    if (input.action === "pause") data.active = false;
    if (input.action === "cancel") {
      data.active = false;
      data.cancelledAt = new Date();
      await tx.recurringOccurrence.deleteMany({ where: { recurringId: id, status: "SCHEDULED" } });
    }
    if (input.action === "resume") {
      data.active = true;
      if ((input.missed ?? "skip") === "skip") {
        // Occurrences that fell due while paused are not recorded.
        data.nextExecutionDate = toDbDate(initialCursor(ruleOf(rule), today));
      }
    }
    await tx.recurringTransaction.update({ where: { id }, data });
    await auditTx(tx, {
      userId,
      action: "RECURRING_UPDATED",
      entity: "RecurringTransaction",
      entityId: id,
      metadata: { action: input.action, missed: input.missed ?? null },
    });
  });
  return getRecurring(userId, id);
}

/** Deletes the rule and its schedule. Recorded transactions stay in history. */
export async function deleteRecurring(userId: string, id: string): Promise<void> {
  await runInTransaction(userId, undefined, async (tx) => {
    const deleted = await tx.recurringTransaction.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw ApiError.notFound("Recurring item not found");
    await auditTx(tx, { userId, action: "RECURRING_DELETED", entity: "RecurringTransaction", entityId: id });
  });
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

function assertOnSchedule(rule: RecurringTransaction, dueDate: ISODate) {
  const r = ruleOf(rule);
  const next = nextOccurrenceOnOrAfter(r, dueDate);
  if (next !== dueDate) throw ApiError.field("dueDate", "That date is not on this item's schedule");
}

async function occurrenceRow(tx: TxClient, rule: RecurringTransaction, dueDate: ISODate) {
  return tx.recurringOccurrence.findUnique({
    where: { recurringId_dueDate: { recurringId: rule.id, dueDate: toDbDate(dueDate) } },
  });
}

/**
 * Pay / record one occurrence exactly once: either create the payment
 * transaction or link an existing posted one. Both paths are atomic, and the
 * unique occurrence + unique transaction link make double clicks and
 * scheduler/manual races settle only once.
 */
export async function settleOccurrence(
  userId: string,
  ruleId: string,
  dueDate: ISODate,
  input:
    | { mode: "create"; accountId?: string; amount?: number; transactionDate?: ISODate }
    | { mode: "link"; transactionId: string },
  opts: { idempotency?: IdempotencyContext } = {}
) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    const rule = await lockRule(tx, userId, ruleId);
    assertOnSchedule(rule, dueDate);
    const existing = await occurrenceRow(tx, rule, dueDate);
    if (existing?.status === "RECORDED") {
      throw ApiError.conflict("This occurrence is already paid/recorded.", "ALREADY_SETTLED");
    }

    let transactionId: string;
    let amount: number;
    if (input.mode === "link") {
      const t = await tx.transaction.findFirst({
        where: { id: input.transactionId, userId, deletedAt: null, status: "POSTED" },
        include: { occurrence: true },
      });
      if (!t) throw ApiError.field("transactionId", "Transaction not found");
      if (t.type !== rule.type) throw ApiError.field("transactionId", `Choose a ${rule.type.toLowerCase()} transaction`);
      if (t.occurrence && t.occurrence.id !== existing?.id && t.occurrence.status === "RECORDED") {
        throw ApiError.field("transactionId", "That transaction already settles another occurrence");
      }
      transactionId = t.id;
      amount = Number(t.amount);
      await tx.transaction.update({ where: { id: t.id }, data: { recurringTransactionId: rule.id, isRecurring: true } });
    } else {
      const accountId = input.accountId ?? rule.accountId;
      await requireOwnedAccounts(tx, userId, [
        { path: "accountId", id: accountId },
        { path: "destinationAccountId", id: rule.destinationAccountId, allowArchived: true },
      ]);
      if (!accountId) throw ApiError.field("accountId", "Select the account you paid from");
      if (rule.type === "EXPENSE" || rule.type === "INCOME") {
        await requireOwnedCategory(tx, userId, rule.categoryId, rule.type, { allowArchived: true });
      }
      amount = input.amount ?? Number(existing?.amount ?? rule.amount);
      const row = await tx.transaction.create({
        data: {
          userId,
          type: rule.type,
          status: "POSTED",
          amount: new Prisma.Decimal(amount.toFixed(2)),
          // Payment date defaults to the day it is recorded (today), not the due date.
          transactionDate: toDbDate(input.transactionDate ?? today),
          accountId,
          destinationAccountId: rule.destinationAccountId,
          categoryId: rule.type === "TRANSFER" ? null : rule.categoryId,
          merchant: rule.merchant,
          description: rule.description ?? rule.name,
          isRecurring: true,
          recurringTransactionId: rule.id,
        },
      });
      await applyEffects(tx, userId, ledgerEffects(row));
      transactionId = row.id;
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          reason: "recurring",
          transactionIds: [row.id],
          dates: [fromDbDate(row.transactionDate)],
          categoryIds: row.categoryId ? [row.categoryId] : [],
          accountIds: [row.accountId, row.destinationAccountId].filter((x): x is string => !!x),
          newExpenseIds: row.type === "EXPENSE" ? [row.id] : [],
        })
      );
    }

    await tx.recurringOccurrence.upsert({
      where: { recurringId_dueDate: { recurringId: rule.id, dueDate: toDbDate(dueDate) } },
      create: {
        userId,
        recurringId: rule.id,
        dueDate: toDbDate(dueDate),
        amount: new Prisma.Decimal(amount.toFixed(2)),
        status: "RECORDED",
        transactionId,
        ruleVersion: rule.version,
        resolvedAt: new Date(),
      },
      update: { status: "RECORDED", transactionId, failureReason: null, resolvedAt: new Date() },
    });
    // Paying ahead: move the cursor past this date so it is never generated again.
    if (fromDbDate(rule.nextExecutionDate) === dueDate) {
      const next = nextOccurrenceOnOrAfter(ruleOf(rule), addDays(dueDate, 1));
      await tx.recurringTransaction.update({
        where: { id: rule.id },
        data: { nextExecutionDate: toDbDate(next ?? addDays(dueDate, 1)), lastExecutedAt: new Date() },
      });
    }
    await auditTx(tx, {
      userId,
      action: "TRANSACTION_CREATED",
      entity: "RecurringOccurrence",
      entityId: rule.id,
      metadata: { dueDate, mode: input.mode, transactionId },
    });
    return { transactionId, dueDate };
  });
  if (!result.replayed) await dispatchEvents(eventIds);
  return { ...result.value, recurring: await getRecurring(userId, ruleId) };
}

export async function updateOccurrence(
  userId: string,
  ruleId: string,
  dueDate: ISODate,
  input: { action: "skip" | "unskip" | "override" | "retry"; amount?: number }
) {
  await runInTransaction(userId, undefined, async (tx) => {
    const rule = await lockRule(tx, userId, ruleId);
    assertOnSchedule(rule, dueDate);
    const existing = await occurrenceRow(tx, rule, dueDate);
    if (existing?.status === "RECORDED") {
      throw ApiError.rule("This occurrence is already recorded. Delete its transaction first to change it.", "ALREADY_SETTLED");
    }
    const materialized = dueDate < fromDbDate(rule.nextExecutionDate);
    const key = { recurringId_dueDate: { recurringId: rule.id, dueDate: toDbDate(dueDate) } };
    const base = { userId, recurringId: rule.id, dueDate: toDbDate(dueDate), ruleVersion: rule.version };
    switch (input.action) {
      case "skip":
        await tx.recurringOccurrence.upsert({
          where: key,
          create: { ...base, amount: rule.amount, status: "SKIPPED", resolvedAt: new Date() },
          update: { status: "SKIPPED", resolvedAt: new Date(), failureReason: null },
        });
        break;
      case "unskip":
        if (existing?.status !== "SKIPPED") throw ApiError.rule("This occurrence is not skipped.", "NOT_SKIPPED");
        if (materialized) {
          await tx.recurringOccurrence.update({ where: key, data: { status: "DUE", resolvedAt: null } });
        } else {
          await tx.recurringOccurrence.delete({ where: key });
        }
        break;
      case "override":
        await tx.recurringOccurrence.upsert({
          where: key,
          create: { ...base, amount: new Prisma.Decimal(input.amount!.toFixed(2)), status: materialized ? "DUE" : "SCHEDULED" },
          update: { amount: new Prisma.Decimal(input.amount!.toFixed(2)) },
        });
        break;
      case "retry":
        if (existing?.status !== "FAILED") throw ApiError.rule("Only failed occurrences can be retried.", "NOT_FAILED");
        await tx.recurringOccurrence.update({ where: key, data: { status: "SCHEDULED", failureReason: null } });
        // Rewind the cursor so the next run re-attempts it.
        if (fromDbDate(rule.nextExecutionDate) > dueDate) {
          await tx.recurringTransaction.update({ where: { id: rule.id }, data: { nextExecutionDate: toDbDate(dueDate) } });
        }
        break;
    }
  });
  if (input.action === "retry") await processRecurring({ userId });
  return getRecurring(userId, ruleId);
}

/** Called when a linked payment is deleted: the occurrence becomes unpaid again. */
export async function reopenOccurrenceForTransaction(tx: TxClient, transactionId: string): Promise<void> {
  await tx.recurringOccurrence.updateMany({
    where: { transactionId, status: "RECORDED" },
    data: { status: "DUE", resolvedAt: null },
  });
}

/** Called when a deleted payment is restored: re-settle if still unpaid. */
export async function relinkOccurrenceForTransaction(tx: TxClient, transactionId: string): Promise<void> {
  await tx.recurringOccurrence.updateMany({
    where: { transactionId, status: "DUE" },
    data: { status: "RECORDED", resolvedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface ProcessSummary {
  rulesProcessed: number;
  transactionsCreated: number;
  occurrencesDue: number;
  failures: number;
  reminders: number;
}

function notificationTypeFor(kind: RecurringKind) {
  return kind === "BILL" ? ("BILL_DUE" as const) : kind === "SUBSCRIPTION" ? ("SUBSCRIPTION_RENEWAL" as const) : ("RECURRING_UPCOMING" as const);
}

async function processRule(ruleId: string, userId: string, today: ISODate, currency: string, summary: ProcessSummary) {
  const eventIds: string[] = [];
  const notices: Parameters<typeof notify>[0][] = [];
  await prisma.$transaction(
    async (tx) => {
      // SKIP LOCKED: a concurrent worker already owns this rule → skip it.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "RecurringTransaction"
        WHERE "id" = ${ruleId} AND "active" = true AND "cancelledAt" IS NULL AND "nextExecutionDate" <= ${today}::date
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return;
      const rule = await tx.recurringTransaction.findUniqueOrThrow({ where: { id: ruleId } });
      const r = ruleOf(rule);
      const dates = occurrencesBetween(r, fromDbDate(rule.nextExecutionDate), addDays(today, 1), MAX_CATCH_UP);
      summary.rulesProcessed += 1;

      for (const dueDate of dates) {
        const existing = await occurrenceRow(tx, rule, dueDate);
        if (existing && existing.status !== "SCHEDULED") continue; // recorded early, skipped, failed or due
        const amount = existing ? existing.amount : rule.amount;
        const key = { recurringId_dueDate: { recurringId: rule.id, dueDate: toDbDate(dueDate) } };

        if (!rule.autoCreate) {
          await tx.recurringOccurrence.upsert({
            where: key,
            create: { userId, recurringId: rule.id, dueDate: toDbDate(dueDate), amount, status: "DUE", ruleVersion: rule.version },
            update: { status: "DUE" },
          });
          summary.occurrencesDue += 1;
          notices.push({
            userId,
            type: notificationTypeFor(rule.kind),
            title: `${rule.name ?? "Payment"} is due`,
            message: `${formatMoney(Number(amount), currency)} was due on ${dueDate}. Record the payment once it is made.`,
            link: `/recurring/${rule.id}`,
            dedupeKey: `due:${rule.id}:${dueDate}`,
          });
          continue;
        }

        // Automatic recording (explicitly enabled). Validate references first.
        const [account, destination, category] = await Promise.all([
          rule.accountId ? tx.account.findFirst({ where: { id: rule.accountId, userId } }) : null,
          rule.destinationAccountId ? tx.account.findFirst({ where: { id: rule.destinationAccountId, userId } }) : null,
          rule.categoryId ? tx.category.findFirst({ where: { id: rule.categoryId, userId } }) : null,
        ]);
        const failure =
          !account ? "The account for this item no longer exists."
          : account.archivedAt ? `"${account.name}" is archived.`
          : rule.type === "TRANSFER" && (!destination || destination.archivedAt) ? "The destination account is missing or archived."
          : rule.type !== "TRANSFER" && !category ? "The category for this item no longer exists."
          : null;
        if (failure) {
          await tx.recurringOccurrence.upsert({
            where: key,
            create: { userId, recurringId: rule.id, dueDate: toDbDate(dueDate), amount, status: "FAILED", failureReason: failure, ruleVersion: rule.version },
            update: { status: "FAILED", failureReason: failure },
          });
          summary.failures += 1;
          notices.push({
            userId,
            type: "RECURRING_FAILED",
            title: `Couldn't record ${rule.name ?? "a recurring item"}`,
            message: `${failure} Fix it and retry from the item's page.`,
            link: `/recurring/${rule.id}`,
            dedupeKey: `failed:${rule.id}:${dueDate}`,
          });
          continue;
        }
        const row = await tx.transaction.create({
          data: {
            userId,
            type: rule.type,
            status: "POSTED",
            amount,
            transactionDate: toDbDate(dueDate),
            accountId: rule.accountId,
            destinationAccountId: rule.type === "TRANSFER" ? rule.destinationAccountId : null,
            categoryId: rule.type === "TRANSFER" ? null : rule.categoryId,
            merchant: rule.merchant,
            description: rule.description ?? rule.name,
            isRecurring: true,
            recurringTransactionId: rule.id,
          },
        });
        await applyEffects(tx, userId, ledgerEffects(row));
        await tx.recurringOccurrence.upsert({
          where: key,
          create: {
            userId,
            recurringId: rule.id,
            dueDate: toDbDate(dueDate),
            amount,
            status: "RECORDED",
            transactionId: row.id,
            ruleVersion: rule.version,
            resolvedAt: new Date(),
          },
          update: { status: "RECORDED", transactionId: row.id, resolvedAt: new Date() },
        });
        summary.transactionsCreated += 1;
        eventIds.push(
          await enqueueEvent(tx, userId, "transactions.changed", {
            reason: "recurring",
            transactionIds: [row.id],
            dates: [dueDate],
            categoryIds: row.categoryId ? [row.categoryId] : [],
            accountIds: [row.accountId, row.destinationAccountId].filter((x): x is string => !!x),
            newExpenseIds: row.type === "EXPENSE" ? [row.id] : [],
          })
        );
      }

      const last = dates[dates.length - 1];
      if (last) {
        const next = nextOccurrenceOnOrAfter(r, addDays(last, 1));
        await tx.recurringTransaction.update({
          where: { id: rule.id },
          data: { nextExecutionDate: toDbDate(next ?? addDays(last, 1)), lastExecutedAt: new Date() },
        });
      }
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
  await dispatchEvents(eventIds);
  for (const n of notices) await notify(n).catch((error) => logger.error("recurring.notify_failed", { error }));
}

async function sendReminders(userId: string, today: ISODate, currency: string, summary: ProcessSummary) {
  const rules = await prisma.recurringTransaction.findMany({
    where: { userId, active: true, cancelledAt: null, reminderDaysBefore: { gt: 0 }, nextExecutionDate: { gt: toDbDate(today) } },
  });
  for (const rule of rules) {
    const due = fromDbDate(rule.nextExecutionDate);
    const days = diffDays(today, due);
    if (days > rule.reminderDaysBefore) continue;
    if (rule.endDate && due > fromDbDate(rule.endDate)) continue;
    const override = await prisma.recurringOccurrence.findUnique({
      where: { recurringId_dueDate: { recurringId: rule.id, dueDate: rule.nextExecutionDate } },
    });
    if (override && override.status !== "SCHEDULED") continue; // paid early or skipped
    const outcome = await notify({
      userId,
      type: notificationTypeFor(rule.kind),
      title: `${rule.name ?? "Payment"} due ${days === 1 ? "tomorrow" : `in ${days} days`}`,
      message: `${formatMoney(Number(override?.amount ?? rule.amount), currency)} on ${due}${rule.autopay ? " (autopay expected — check it went through)" : ""}.`,
      link: `/recurring/${rule.id}`,
      dedupeKey: `reminder:${rule.id}:${due}`,
    });
    if (outcome === "created") summary.reminders += 1;
  }
}

/**
 * Materialises due occurrences for one user (app sync) or everybody (cron).
 * Idempotent and concurrency-safe: rows are locked with SKIP LOCKED and every
 * occurrence is unique per (rule, date), so retries and parallel workers can
 * never record the same occurrence twice.
 */
export async function processRecurring(opts: { userId?: string; now?: Date } = {}): Promise<ProcessSummary> {
  const summary: ProcessSummary = { rulesProcessed: 0, transactionsCreated: 0, occurrencesDue: 0, failures: 0, reminders: 0 };
  const userIds = opts.userId
    ? [opts.userId]
    : (
        await prisma.recurringTransaction.findMany({
          where: { active: true, cancelledAt: null },
          distinct: ["userId"],
          select: { userId: true },
        })
      ).map((r) => r.userId);

  for (const userId of userIds) {
    try {
      const settings = await getUserSettings(userId);
      const today = todayFor(settings, opts.now);
      const due = await prisma.recurringTransaction.findMany({
        where: { userId, active: true, cancelledAt: null, nextExecutionDate: { lte: toDbDate(today) } },
        select: { id: true },
        take: 500,
      });
      for (const { id } of due) {
        try {
          await processRule(id, userId, today, settings.currency, summary);
        } catch (error) {
          summary.failures += 1;
          logger.error("recurring.rule_failed", { ruleId: id, error });
        }
      }
      await sendReminders(userId, today, settings.currency, summary);
    } catch (error) {
      logger.error("recurring.user_failed", { userId, error });
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Projection support (calendar, cash flow, safe-to-spend)
// ---------------------------------------------------------------------------

export interface ScheduledItem {
  /** Stable identity: one entry per (rule, date) — never counted twice. */
  key: string;
  ruleId: string;
  name: string;
  kind: RecurringKind;
  type: TransactionType;
  date: ISODate;
  amount: number;
  status: OccurrenceStatus | "EXPECTED";
  accountId: string | null;
  destinationAccountId: string | null;
  categoryId: string | null;
  transactionId: string | null;
}

/**
 * Every occurrence in [from, to): materialised rows (with their status) merged
 * with not-yet-generated schedule dates of active rules. Deduplicated by
 * (rule, date), so a bill that is also shown as a subscription or recurring
 * expense is counted once.
 */
export async function listScheduledItems(userId: string, from: ISODate, to: ISODate): Promise<ScheduledItem[]> {
  const [rules, occurrences] = await Promise.all([
    prisma.recurringTransaction.findMany({ where: { userId } }),
    prisma.recurringOccurrence.findMany({
      where: { userId, dueDate: { gte: toDbDate(from), lt: toDbDate(to) } },
    }),
  ]);
  const byRule = new Map(rules.map((r) => [r.id, r]));
  const items = new Map<string, ScheduledItem>();
  for (const o of occurrences) {
    const rule = byRule.get(o.recurringId);
    if (!rule) continue;
    const date = fromDbDate(o.dueDate);
    items.set(`${rule.id}:${date}`, {
      key: `${rule.id}:${date}`,
      ruleId: rule.id,
      name: rule.name ?? rule.merchant ?? "Recurring item",
      kind: rule.kind,
      type: rule.type,
      date,
      amount: Number(o.amount),
      status: o.status,
      accountId: rule.accountId,
      destinationAccountId: rule.destinationAccountId,
      categoryId: rule.categoryId,
      transactionId: o.transactionId,
    });
  }
  for (const rule of rules) {
    if (!rule.active || rule.cancelledAt) continue;
    const cursor = fromDbDate(rule.nextExecutionDate);
    const start = cursor > from ? cursor : from;
    for (const date of occurrencesBetween(ruleOf(rule), start, to, 400)) {
      const key = `${rule.id}:${date}`;
      if (items.has(key)) continue;
      items.set(key, {
        key,
        ruleId: rule.id,
        name: rule.name ?? rule.merchant ?? "Recurring item",
        kind: rule.kind,
        type: rule.type,
        date,
        amount: Number(rule.amount),
        status: "EXPECTED",
        accountId: rule.accountId,
        destinationAccountId: rule.destinationAccountId,
        categoryId: rule.categoryId,
        transactionId: null,
      });
    }
  }
  return [...items.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}

/** Validates that an occurrence index exists (test helper / preview). */
export function occurrenceDate(rule: RecurrenceRule, k: number): ISODate {
  return occurrenceAt(rule, k);
}
