import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { fromDbDate, toDbDate, type ISODate } from "@/lib/dates/date-only";
import { fromMinor, toMinor } from "@/lib/utils/money";
import {
  splitIssues,
  transactionShapeIssues,
  type RefundCreateInput,
  type SplitLineInput,
  type TransactionCreateInput,
  type TransactionQueryInput,
  type TransactionUpdateInput,
} from "@/lib/validation/schemas";
import type { Paginated } from "@/types";
import { runInTransaction, type IdempotencyContext, type TxClient } from "@/server/db/idempotency";
import { applyEffects, effectsDiff, ledgerEffects } from "@/server/ledger/effects";
import { dispatchEvents, enqueueEvent, type TransactionsChangedPayload } from "@/server/events/outbox";
import { requireOwnedAccounts, requireOwnedCategory } from "@/server/services/ownership";
import { auditTx } from "@/server/services/audit.service";
import { resolveMerchantId } from "@/server/services/merchant.service";
import { relinkOccurrenceForTransaction, reopenOccurrenceForTransaction } from "@/server/services/recurring.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";
import type { TransactionDTO, TransactionListTotals } from "./transaction.types";

export const TX_INCLUDE = {
  category: true,
  account: true,
  destinationAccount: true,
  merchantRef: { select: { name: true } },
  splits: { include: { category: { select: { name: true, color: true } } }, orderBy: { position: "asc" } },
  refunds: { where: { deletedAt: null }, select: { amount: true, categoryId: true } },
  _count: { select: { attachments: true } },
} satisfies Prisma.TransactionInclude;

export type DbTransaction = Prisma.TransactionGetPayload<{ include: typeof TX_INCLUDE }>;

function accountRef(a: DbTransaction["account"]) {
  return a ? { id: a.id, name: a.name, type: a.type, archived: a.archivedAt != null } : null;
}

export function mapTransaction(tx: DbTransaction, perspectiveAccountId?: string): TransactionDTO {
  const refundedMinor = tx.refunds.reduce((a, r) => a + toMinor(r.amount.toString()), 0);
  const dto: TransactionDTO = {
    id: tx.id,
    type: tx.type,
    status: tx.status,
    amount: Number(tx.amount),
    transactionDate: fromDbDate(tx.transactionDate),
    description: tx.description,
    merchant: tx.merchant,
    merchantName: tx.merchantRef?.name ?? null,
    merchantId: tx.merchantId,
    paymentMethod: tx.paymentMethod,
    notes: tx.notes,
    location: tx.location,
    tags: tx.tags,
    isRecurring: tx.isRecurring,
    recurringTransactionId: tx.recurringTransactionId,
    accountId: tx.accountId,
    destinationAccountId: tx.destinationAccountId,
    categoryId: tx.categoryId,
    account: accountRef(tx.account),
    destinationAccount: accountRef(tx.destinationAccount),
    category: tx.category
      ? { id: tx.category.id, name: tx.category.name, color: tx.category.color, icon: tx.category.icon, type: tx.category.type }
      : null,
    isSplit: tx.isSplit,
    splits: tx.splits.map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      categoryName: s.category.name,
      categoryColor: s.category.color,
      amount: Number(s.amount),
      note: s.note,
    })),
    originalTransactionId: tx.originalTransactionId,
    refundedAmount: fromMinor(refundedMinor),
    refundCount: tx.refunds.length,
    reconciled: tx.reconciledAt != null,
    attachmentCount: tx._count.attachments,
    importJobId: tx.importJobId,
    version: tx.version,
    deleted: tx.deletedAt != null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
  if (perspectiveAccountId) {
    // Planned rows have no actual effect; show their would-be effect for context.
    const effects = ledgerEffects({ ...tx, status: "POSTED", deletedAt: null });
    dto.accountEffect = fromMinor(effects.get(perspectiveAccountId) ?? 0);
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function buildTransactionWhere(userId: string, q: Partial<TransactionQueryInput>): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ userId, deletedAt: null }];
  if (q.search) {
    and.push({
      OR: [
        { merchant: { contains: q.search, mode: "insensitive" } },
        { description: { contains: q.search, mode: "insensitive" } },
        { notes: { contains: q.search, mode: "insensitive" } },
        { merchantRef: { name: { contains: q.search, mode: "insensitive" } } },
        { category: { name: { contains: q.search, mode: "insensitive" } } },
        { tags: { has: q.search } },
      ],
    });
  }
  if (q.type) and.push({ type: q.type as Prisma.EnumTransactionTypeFilter["equals"] });
  if (q.status) and.push({ status: q.status });
  // A split purchase matches every category it is allocated to.
  if (q.categoryId) and.push({ OR: [{ categoryId: q.categoryId }, { splits: { some: { categoryId: q.categoryId } } }] });
  if (q.uncategorized) and.push({ categoryId: null, isSplit: false, type: { in: ["EXPENSE", "INCOME"] } });
  if (q.accountId) and.push({ OR: [{ accountId: q.accountId }, { destinationAccountId: q.accountId }] });
  if (q.merchant) {
    and.push({
      OR: [{ merchant: { contains: q.merchant, mode: "insensitive" } }, { merchantRef: { name: { equals: q.merchant, mode: "insensitive" } } }],
    });
  }
  if (q.paymentMethod) and.push({ paymentMethod: { equals: q.paymentMethod, mode: "insensitive" } });
  if (q.tag) and.push({ tags: { has: q.tag } });
  if (q.minAmount != null || q.maxAmount != null) {
    and.push({
      amount: {
        ...(q.minAmount != null ? { gte: new Prisma.Decimal(q.minAmount) } : {}),
        ...(q.maxAmount != null ? { lte: new Prisma.Decimal(q.maxAmount) } : {}),
      },
    });
  }
  if (q.startDate || q.endDate) {
    and.push({
      transactionDate: {
        ...(q.startDate ? { gte: toDbDate(q.startDate) } : {}),
        ...(q.endDate ? { lte: toDbDate(q.endDate) } : {}),
      },
    });
  }
  return { AND: and };
}

function orderBy(q: TransactionQueryInput): Prisma.TransactionOrderByWithRelationInput[] {
  const dir = q.sortDir;
  const primary: Prisma.TransactionOrderByWithRelationInput =
    q.sortBy === "merchant" ? { merchant: { sort: dir, nulls: "last" } } : { [q.sortBy]: dir };
  // Stable tiebreakers so pagination never skips or repeats rows.
  return [primary, { createdAt: dir }, { id: dir }];
}

export async function listTransactions(
  userId: string,
  q: TransactionQueryInput
): Promise<Paginated<TransactionDTO> & { totals: TransactionListTotals }> {
  const where = buildTransactionWhere(userId, q);
  const [items, total, sums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: TX_INCLUDE,
      orderBy: orderBy(q),
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.groupBy({ by: ["type"], where: { AND: [where, { status: "POSTED" }] }, _sum: { amount: true } }),
  ]);
  const sumOf = (type: string) => Number(sums.find((s) => s.type === type)?._sum.amount ?? 0);
  return {
    items: items.map((t) => mapTransaction(t, q.accountId)),
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    totals: { count: total, income: sumOf("INCOME"), expense: sumOf("EXPENSE"), refunds: sumOf("REFUND"), transfers: sumOf("TRANSFER") },
  };
}

/** Ids matching a filter — for "select all matching" bulk actions (bounded). */
export async function listMatchingIds(userId: string, q: Partial<TransactionQueryInput>, limit = 500): Promise<{ ids: string[]; total: number; truncated: boolean }> {
  const where = buildTransactionWhere(userId, q);
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({ where, select: { id: true }, orderBy: [{ transactionDate: "desc" }, { id: "desc" }], take: limit }),
    prisma.transaction.count({ where }),
  ]);
  return { ids: rows.map((r) => r.id), total, truncated: total > limit };
}

/** All rows matching a filter (exports). Bounded to protect the server. */
export async function listAllMatching(userId: string, q: Partial<TransactionQueryInput>, limit = 50_000): Promise<TransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: buildTransactionWhere(userId, q),
    include: TX_INCLUDE,
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return rows.map((t) => mapTransaction(t));
}

export async function getTransaction(userId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<TransactionDTO & { refunds: TransactionDTO[]; original: TransactionDTO | null }> {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
    include: TX_INCLUDE,
  });
  if (!tx) throw ApiError.notFound("Transaction not found");
  const [refunds, original] = await Promise.all([
    tx.type === "EXPENSE"
      ? prisma.transaction.findMany({ where: { userId, originalTransactionId: id, deletedAt: null }, include: TX_INCLUDE, orderBy: { transactionDate: "asc" } })
      : [],
    tx.originalTransactionId ? prisma.transaction.findFirst({ where: { id: tx.originalTransactionId, userId }, include: TX_INCLUDE }) : null,
  ]);
  return { ...mapTransaction(tx), refunds: refunds.map((r) => mapTransaction(r)), original: original ? mapTransaction(original) : null };
}

export async function listTags(userId: string): Promise<{ tag: string; count: number }[]> {
  const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT tag, COUNT(*) AS count
    FROM "Transaction" t, unnest(t."tags") AS tag
    WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
    GROUP BY tag ORDER BY COUNT(*) DESC, tag ASC LIMIT 200`;
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface Normalized {
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number;
  transactionDate: ISODate;
  accountId: string;
  destinationAccountId: string | null;
  categoryId: string | null;
  description: string | null;
  merchant: string | null;
  paymentMethod: string | null;
  notes: string | null;
  location: string | null;
  tags: string[];
  splits: SplitLineInput[] | null;
}

async function validateReferences(
  tx: TxClient,
  userId: string,
  next: Normalized,
  previous?: { accountId: string | null; destinationAccountId: string | null; categoryId: string | null; splitCategoryIds?: string[] }
) {
  const issues = [...transactionShapeIssues(next), ...splitIssues(next.amount, next.splits)];
  if (next.splits && next.splits.length) {
    if (next.type === "TRANSFER") issues.push({ path: ["splits"], message: "Transfers can't be split" });
    if (next.splits.length < 2) issues.push({ path: ["splits"], message: "A split needs at least two lines" });
  }
  if (issues.length) throw ApiError.validation(issues);
  // Keeping an existing (possibly archived) reference is allowed when editing history.
  await requireOwnedAccounts(tx, userId, [
    { path: "accountId", id: next.accountId, allowArchived: previous?.accountId === next.accountId },
    { path: "destinationAccountId", id: next.destinationAccountId, allowArchived: previous?.destinationAccountId === next.destinationAccountId },
  ]);
  if (next.type === "TRANSFER") return;
  if (next.splits && next.splits.length) {
    for (const [i, line] of next.splits.entries()) {
      await requireOwnedCategory(tx, userId, line.categoryId, next.type, {
        path: `splits.${i}.categoryId`,
        allowArchived: previous?.splitCategoryIds?.includes(line.categoryId),
      });
    }
  } else {
    await requireOwnedCategory(tx, userId, next.categoryId, next.type, { allowArchived: previous?.categoryId === next.categoryId });
  }
}

async function writeSplits(tx: TxClient, userId: string, transactionId: string, splits: SplitLineInput[] | null) {
  await tx.transactionSplit.deleteMany({ where: { transactionId } });
  if (splits && splits.length) {
    await tx.transactionSplit.createMany({
      data: splits.map((l, i) => ({
        userId,
        transactionId,
        categoryId: l.categoryId,
        amount: new Prisma.Decimal(l.amount.toFixed(2)),
        note: l.note ?? null,
        position: i,
      })),
    });
  }
}

type ChangedRow = { id: string; type: string; transactionDate: Date; categoryId: string | null; accountId: string | null; destinationAccountId: string | null; status: string; splits?: { categoryId: string }[] };

function changedPayload(reason: TransactionsChangedPayload["reason"], rows: ChangedRow[], newExpense: boolean): TransactionsChangedPayload {
  const uniq = <T>(v: (T | null | undefined)[]) => [...new Set(v.filter((x): x is T => x != null))];
  return {
    reason,
    transactionIds: uniq(rows.map((r) => r.id)),
    dates: uniq(rows.map((r) => fromDbDate(r.transactionDate))),
    categoryIds: uniq(rows.flatMap((r) => [r.categoryId, ...(r.splits ?? []).map((s) => s.categoryId)])),
    accountIds: uniq(rows.flatMap((r) => [r.accountId, r.destinationAccountId])),
    newExpenseIds: newExpense ? uniq(rows.filter((r) => r.type === "EXPENSE" && r.status === "POSTED").map((r) => r.id)) : [],
  };
}

async function lockTransaction(tx: TxClient, userId: string, id: string): Promise<DbTransaction> {
  await tx.$queryRaw`SELECT "id" FROM "Transaction" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
  const row = await tx.transaction.findFirst({ where: { id, userId }, include: TX_INCLUDE });
  if (!row) throw ApiError.notFound("Transaction not found");
  return row;
}

/**
 * Reconciliation policy: a change dated inside a completed statement period of
 * an affected account reopens that reconciliation (the verified balance no
 * longer holds). Returns human-readable warnings.
 */
async function reopenReconciliations(tx: TxClient, userId: string, accountIds: (string | null)[], date: Date, reason: string): Promise<string[]> {
  const ids = accountIds.filter((x): x is string => !!x);
  if (!ids.length) return [];
  const affected = await tx.reconciliation.findMany({
    where: { userId, accountId: { in: ids }, status: "COMPLETED", statementDate: { gte: date } },
    include: { account: { select: { name: true } } },
  });
  if (!affected.length) return [];
  await tx.reconciliation.updateMany({
    where: { id: { in: affected.map((r) => r.id) } },
    data: { status: "REOPENED", reopenedAt: new Date(), reopenReason: reason },
  });
  await tx.transaction.updateMany({ where: { userId, reconciliationId: { in: affected.map((r) => r.id) } }, data: { reconciledAt: null } });
  return affected.map((r) => `The reconciliation of ${r.account.name} for ${fromDbDate(r.statementDate)} was reopened because this change falls inside that statement period.`);
}

/** Minor-unit allocation per category (split lines or the single category). */
function allocationByCategory(t: { amount: number; categoryId: string | null; splits: { categoryId: string; amount: number }[] | null }) {
  const map = new Map<string, number>();
  if (t.splits && t.splits.length) {
    for (const l of t.splits) map.set(l.categoryId, (map.get(l.categoryId) ?? 0) + toMinor(l.amount));
  } else if (t.categoryId) {
    map.set(t.categoryId, toMinor(t.amount));
  }
  return map;
}

function refundedByCategory(refunds: { amount: Prisma.Decimal; categoryId: string | null }[]) {
  const map = new Map<string, number>();
  for (const r of refunds) map.set(r.categoryId ?? "", (map.get(r.categoryId ?? "") ?? 0) + toMinor(r.amount.toString()));
  return map;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface MutationOptions {
  idempotency?: IdempotencyContext;
}

export async function createTransaction(
  userId: string,
  input: TransactionCreateInput,
  opts: MutationOptions = {}
): Promise<{ transaction: TransactionDTO; replayed: boolean; warnings: string[] }> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const status = input.status ?? (input.transactionDate > today ? "PLANNED" : "POSTED");
  const splits = input.type !== "TRANSFER" && input.splits && input.splits.length ? input.splits : null;
  const next: Normalized = {
    type: input.type,
    amount: input.amount,
    transactionDate: input.transactionDate,
    accountId: input.accountId,
    destinationAccountId: input.destinationAccountId ?? null,
    categoryId: splits ? null : (input.categoryId ?? null),
    description: input.description ?? null,
    merchant: input.merchant ?? null,
    paymentMethod: input.paymentMethod ?? null,
    notes: input.notes ?? null,
    location: input.location ?? null,
    tags: input.tags ?? [],
    splits,
  };

  const eventIds: string[] = [];
  const warnings: string[] = [];
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    await validateReferences(tx, userId, next);
    const merchantId = await resolveMerchantId(tx, userId, next.merchant);
    const created = await tx.transaction.create({
      data: {
        userId,
        type: next.type,
        status,
        amount: new Prisma.Decimal(next.amount.toFixed(2)),
        transactionDate: toDbDate(next.transactionDate),
        accountId: next.accountId,
        destinationAccountId: next.destinationAccountId,
        categoryId: next.type === "TRANSFER" ? null : next.categoryId,
        isSplit: !!splits,
        merchantId,
        description: next.description,
        merchant: next.merchant,
        paymentMethod: next.paymentMethod,
        notes: next.notes,
        location: next.location,
        tags: next.tags,
      },
    });
    await writeSplits(tx, userId, created.id, splits);
    const row = await tx.transaction.findUniqueOrThrow({ where: { id: created.id }, include: TX_INCLUDE });
    await applyEffects(tx, userId, ledgerEffects(row));
    if (status === "POSTED") {
      warnings.push(...(await reopenReconciliations(tx, userId, [row.accountId, row.destinationAccountId], row.transactionDate, "A new transaction was added in this statement period")));
    }
    await auditTx(tx, { userId, action: "TRANSACTION_CREATED", entity: "Transaction", entityId: row.id, metadata: { type: row.type, status: row.status } });
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("created", [row], true)));
    return mapTransaction(row);
  });
  if (!result.replayed) await dispatchEvents(eventIds);
  return { transaction: result.value, replayed: result.replayed, warnings };
}

export async function updateTransaction(userId: string, id: string, input: TransactionUpdateInput): Promise<TransactionDTO & { warnings: string[] }> {
  const eventIds: string[] = [];
  const warnings: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const existing = await lockTransaction(tx, userId, id);
    if (existing.deletedAt) throw ApiError.rule("This transaction was deleted. Restore it before editing.", "TRANSACTION_DELETED");
    if (existing.version !== input.version) throw ApiError.versionConflict("transaction");
    if (existing.reconciledAt && !input.confirmReconciledChange) {
      throw ApiError.conflict(
        "This transaction is part of a reconciled statement. Editing it will reopen that reconciliation — confirm to continue.",
        "RECONCILED_CHANGE"
      );
    }
    if (existing.type === "ADJUSTMENT" || existing.type === "REFUND") {
      const touchesMoney =
        input.amount !== undefined || input.transactionDate !== undefined || input.type !== undefined ||
        input.accountId !== undefined || input.destinationAccountId !== undefined || input.splits !== undefined ||
        (existing.type === "ADJUSTMENT" && input.categoryId !== undefined);
      if (touchesMoney) {
        throw ApiError.rule(
          existing.type === "ADJUSTMENT"
            ? "Balance adjustments can't be edited. Delete it and record a new adjustment instead."
            : "To change a refund's amount, date or account, delete it and record the refund again.",
          existing.type === "ADJUSTMENT" ? "ADJUSTMENT_LOCKED" : "REFUND_LOCKED"
        );
      }
    }

    const has = <K extends keyof TransactionUpdateInput>(k: K) => input[k] !== undefined;
    const type = (input.type ?? existing.type) as Normalized["type"];
    const existingSplits = existing.splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount), note: s.note }));
    const splits = type === "TRANSFER" ? null : has("splits") ? (input.splits && input.splits.length ? input.splits : null) : existing.isSplit ? existingSplits : null;
    const merged: Normalized = {
      type,
      amount: input.amount ?? Number(existing.amount),
      transactionDate: input.transactionDate ?? fromDbDate(existing.transactionDate),
      accountId: (input.accountId ?? existing.accountId) as string,
      destinationAccountId: has("destinationAccountId") ? (input.destinationAccountId ?? null) : existing.destinationAccountId,
      categoryId: splits ? null : has("categoryId") ? (input.categoryId ?? null) : existing.categoryId,
      description: has("description") ? (input.description ?? null) : existing.description,
      merchant: has("merchant") ? (input.merchant ?? null) : existing.merchant,
      paymentMethod: has("paymentMethod") ? (input.paymentMethod ?? null) : existing.paymentMethod,
      notes: has("notes") ? (input.notes ?? null) : existing.notes,
      location: has("location") ? (input.location ?? null) : existing.location,
      tags: input.tags ?? existing.tags,
      splits,
    };

    if (existing.type === "REFUND") {
      // Only labels may change on a refund; keep its category allocation valid.
      if (has("categoryId") && merged.categoryId && existing.originalTransactionId) {
        const original = await tx.transaction.findFirst({ where: { id: existing.originalTransactionId, userId }, include: { splits: true } });
        const allowed = original?.isSplit ? original.splits.map((s) => s.categoryId) : [original?.categoryId];
        if (!allowed.includes(merged.categoryId)) throw ApiError.field("categoryId", "A refund must use one of the original purchase's categories");
      }
    } else if (existing.type !== "ADJUSTMENT") {
      await validateReferences(tx, userId, merged, {
        accountId: existing.accountId,
        destinationAccountId: existing.destinationAccountId,
        categoryId: existing.categoryId,
        splitCategoryIds: existing.splits.map((s) => s.categoryId),
      });
    }

    // Edits must keep existing refunds valid (never below what was refunded).
    if (existing.refunds.length) {
      if (type !== "EXPENSE") throw ApiError.rule("This purchase has refunds, so it must stay an expense.", "REFUNDS_EXIST");
      const alloc = allocationByCategory({ amount: merged.amount, categoryId: merged.categoryId, splits: merged.splits });
      for (const [categoryId, refunded] of refundedByCategory(existing.refunds)) {
        const available = alloc.get(categoryId) ?? 0;
        if (available < refunded) {
          throw ApiError.validation([
            { path: [merged.splits ? "splits" : "amount"], message: `Refunds of ${fromMinor(refunded).toFixed(2)} already exist for this purchase; the amount can't go below that.` },
          ]);
        }
      }
    }

    const merchantId = merged.merchant === existing.merchant ? existing.merchantId : await resolveMerchantId(tx, userId, merged.merchant);
    await tx.transaction.update({
      where: { id },
      data: {
        type: merged.type === existing.type ? undefined : merged.type,
        amount: new Prisma.Decimal(merged.amount.toFixed(2)),
        transactionDate: toDbDate(merged.transactionDate),
        accountId: merged.accountId,
        destinationAccountId: merged.destinationAccountId,
        categoryId: merged.type === "TRANSFER" ? null : merged.categoryId,
        isSplit: !!merged.splits,
        merchantId,
        description: merged.description,
        merchant: merged.merchant,
        paymentMethod: merged.paymentMethod,
        notes: merged.notes,
        location: merged.location,
        tags: merged.tags,
        version: { increment: 1 },
      },
    });
    if (has("splits") || type === "TRANSFER") await writeSplits(tx, userId, id, merged.splits);
    const updated = await tx.transaction.findUniqueOrThrow({ where: { id }, include: TX_INCLUDE });
    await applyEffects(tx, userId, effectsDiff(existing, updated));
    const earliest = existing.transactionDate < updated.transactionDate ? existing.transactionDate : updated.transactionDate;
    warnings.push(
      ...(await reopenReconciliations(
        tx,
        userId,
        [existing.accountId, existing.destinationAccountId, updated.accountId, updated.destinationAccountId],
        earliest,
        "A transaction in this statement period was edited"
      ))
    );
    await auditTx(tx, { userId, action: "TRANSACTION_UPDATED", entity: "Transaction", entityId: id });
    const moneyChanged =
      toMinor(existing.amount.toString()) !== toMinor(updated.amount.toString()) || existing.type !== updated.type || existing.categoryId !== updated.categoryId;
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("updated", [existing, updated], moneyChanged)));
    return mapTransaction(updated);
  });
  await dispatchEvents(eventIds);
  return { ...result.value, warnings };
}

async function softDelete(tx: TxClient, userId: string, existing: DbTransaction) {
  const updated = await tx.transaction.update({ where: { id: existing.id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
  await applyEffects(tx, userId, effectsDiff(existing, updated));
  // A deleted payment no longer settles its bill/subscription occurrence.
  await reopenOccurrenceForTransaction(tx, existing.id);
  await auditTx(tx, { userId, action: "TRANSACTION_DELETED", entity: "Transaction", entityId: existing.id });
  return updated;
}

/**
 * Soft delete: reverses the ledger effect atomically; restorable via undo.
 * A purchase with active refunds is blocked unless `withRefunds` explicitly
 * resolves the dependency (its refunds are deleted in the same transaction).
 */
export async function deleteTransaction(
  userId: string,
  id: string,
  opts: { version?: number; withRefunds?: boolean; confirmReconciledChange?: boolean } = {}
): Promise<{ id: string; version: number; deletedRefundIds: string[]; warnings: string[] }> {
  const eventIds: string[] = [];
  const warnings: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const existing = await lockTransaction(tx, userId, id);
    if (existing.deletedAt) throw ApiError.notFound("Transaction not found");
    if (opts.version != null && existing.version !== opts.version) throw ApiError.versionConflict("transaction");
    if (existing.reconciledAt && !opts.confirmReconciledChange) {
      throw ApiError.conflict(
        "This transaction is part of a reconciled statement. Deleting it will reopen that reconciliation — confirm to continue.",
        "RECONCILED_CHANGE"
      );
    }
    const refunds = existing.refunds.length
      ? await tx.transaction.findMany({ where: { userId, originalTransactionId: id, deletedAt: null }, include: TX_INCLUDE })
      : [];
    if (refunds.length && !opts.withRefunds) {
      throw ApiError.rule(
        `This purchase has ${refunds.length} refund(s). Delete them first, or delete the purchase together with its refunds.`,
        "REFUNDS_EXIST"
      );
    }
    for (const r of refunds) await softDelete(tx, userId, r);
    const updated = await softDelete(tx, userId, existing);
    warnings.push(...(await reopenReconciliations(tx, userId, [existing.accountId, existing.destinationAccountId], existing.transactionDate, "A transaction in this statement period was deleted")));
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("deleted", [existing, ...refunds], false)));
    return { id, version: updated.version, deletedRefundIds: refunds.map((r) => r.id), warnings };
  });
  await dispatchEvents(eventIds);
  return result.value;
}

/** Undo of a soft delete: re-applies the full ledger effect. */
export async function restoreTransaction(userId: string, id: string): Promise<TransactionDTO> {
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const existing = await lockTransaction(tx, userId, id);
    if (!existing.deletedAt) return mapTransaction(existing);
    if (!existing.accountId && !existing.destinationAccountId) {
      throw ApiError.rule("This transaction's account no longer exists, so it cannot be restored.", "RESTORE_IMPOSSIBLE");
    }
    if (existing.type === "TRANSFER" && (!existing.accountId || !existing.destinationAccountId)) {
      throw ApiError.rule("One side of this transfer no longer exists, so it cannot be restored.", "RESTORE_IMPOSSIBLE");
    }
    if (existing.originalTransactionId) {
      const original = await tx.transaction.findFirst({ where: { id: existing.originalTransactionId, userId } });
      if (!original || original.deletedAt) throw ApiError.rule("Restore the original purchase before restoring its refund.", "RESTORE_IMPOSSIBLE");
    }
    await tx.transaction.update({ where: { id }, data: { deletedAt: null, version: { increment: 1 } } });
    const updated = await tx.transaction.findUniqueOrThrow({ where: { id }, include: TX_INCLUDE });
    await applyEffects(tx, userId, effectsDiff(existing, updated));
    await relinkOccurrenceForTransaction(tx, id);
    await reopenReconciliations(tx, userId, [updated.accountId, updated.destinationAccountId], updated.transactionDate, "A deleted transaction in this period was restored");
    await auditTx(tx, { userId, action: "TRANSACTION_RESTORED", entity: "Transaction", entityId: id });
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("restored", [updated], false)));
    return mapTransaction(updated);
  });
  await dispatchEvents(eventIds);
  return result.value;
}

/** PLANNED → POSTED: the explicit transition that makes a planned entry real. */
export async function postTransaction(userId: string, id: string, input: { version: number; transactionDate?: ISODate }): Promise<TransactionDTO> {
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const existing = await lockTransaction(tx, userId, id);
    if (existing.deletedAt) throw ApiError.notFound("Transaction not found");
    if (existing.version !== input.version) throw ApiError.versionConflict("transaction");
    if (existing.status === "POSTED") throw ApiError.rule("This transaction is already posted.", "ALREADY_POSTED");
    await requireOwnedAccounts(tx, userId, [
      { path: "accountId", id: existing.accountId },
      { path: "destinationAccountId", id: existing.destinationAccountId },
    ]);
    await tx.transaction.update({
      where: { id },
      data: { status: "POSTED", ...(input.transactionDate ? { transactionDate: toDbDate(input.transactionDate) } : {}), version: { increment: 1 } },
    });
    const updated = await tx.transaction.findUniqueOrThrow({ where: { id }, include: TX_INCLUDE });
    await applyEffects(tx, userId, effectsDiff(existing, updated));
    await auditTx(tx, { userId, action: "TRANSACTION_POSTED", entity: "Transaction", entityId: id });
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("posted", [existing, updated], true)));
    return mapTransaction(updated);
  });
  await dispatchEvents(eventIds);
  return result.value;
}

/**
 * Records a refund against a purchase. The refund posts to the receiving
 * account (+), is reported on its own date, and reduces spending in the
 * allocated category. Cumulative refunds per category never exceed what the
 * purchase allocated to that category.
 */
export async function createRefund(
  userId: string,
  originalId: string,
  input: RefundCreateInput,
  opts: MutationOptions = {}
): Promise<{ transaction: TransactionDTO; replayed: boolean }> {
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    const original = await lockTransaction(tx, userId, originalId);
    if (original.deletedAt) throw ApiError.notFound("Transaction not found");
    if (original.type !== "EXPENSE") throw ApiError.rule("Only expenses can be refunded.", "NOT_REFUNDABLE");
    if (original.status !== "POSTED") throw ApiError.rule("Post this planned expense before recording a refund.", "NOT_REFUNDABLE");
    if (input.transactionDate < fromDbDate(original.transactionDate)) {
      throw ApiError.field("transactionDate", "A refund can't be dated before the purchase");
    }
    await requireOwnedAccounts(tx, userId, [{ path: "accountId", id: input.accountId, allowArchived: input.accountId === original.accountId }]);

    const alloc = allocationByCategory({
      amount: Number(original.amount),
      categoryId: original.categoryId,
      splits: original.splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount) })),
    });
    const categoryId = input.categoryId ?? (original.isSplit ? null : original.categoryId);
    if (!categoryId) throw ApiError.field("categoryId", "Choose which part of the purchase was refunded");
    if (!alloc.has(categoryId)) throw ApiError.field("categoryId", "Choose one of the purchase's categories");
    const refunded = refundedByCategory(original.refunds).get(categoryId) ?? 0;
    const remaining = (alloc.get(categoryId) ?? 0) - refunded;
    if (toMinor(input.amount) > remaining) {
      throw ApiError.field("amount", remaining > 0 ? `At most ${fromMinor(remaining).toFixed(2)} can still be refunded for this category` : "This purchase has already been fully refunded");
    }

    const created = await tx.transaction.create({
      data: {
        userId,
        type: "REFUND",
        status: "POSTED",
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        transactionDate: toDbDate(input.transactionDate),
        accountId: input.accountId,
        categoryId,
        originalTransactionId: original.id,
        merchant: original.merchant,
        merchantId: original.merchantId,
        description: input.description ?? `Refund: ${original.merchant ?? original.description ?? "purchase"}`,
        notes: input.notes ?? null,
        tags: original.tags,
      },
    });
    const row = await tx.transaction.findUniqueOrThrow({ where: { id: created.id }, include: TX_INCLUDE });
    await applyEffects(tx, userId, ledgerEffects(row));
    await reopenReconciliations(tx, userId, [row.accountId], row.transactionDate, "A refund was added in this statement period");
    await auditTx(tx, { userId, action: "TRANSACTION_CREATED", entity: "Transaction", entityId: row.id, metadata: { type: "REFUND", originalTransactionId: original.id } });
    eventIds.push(await enqueueEvent(tx, userId, "transactions.changed", changedPayload("created", [row, original], false)));
    return mapTransaction(row);
  });
  if (!result.replayed) await dispatchEvents(eventIds);
  return { transaction: result.value, replayed: result.replayed };
}

/**
 * Duplicate = an editable draft (nothing is written). Ids, recurrence links,
 * refund links and settlement/reconciliation markers are stripped; the date
 * becomes today.
 */
export async function getDuplicateDraft(userId: string, id: string) {
  const source = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null }, include: { splits: { orderBy: { position: "asc" } } } });
  if (!source) throw ApiError.notFound("Transaction not found");
  if (source.type === "ADJUSTMENT" || source.type === "REFUND") {
    throw ApiError.rule("Balance adjustments and refunds cannot be duplicated.", "NOT_DUPLICABLE");
  }
  const settings = await getUserSettings(userId);
  return {
    type: source.type as "EXPENSE" | "INCOME" | "TRANSFER",
    amount: Number(source.amount),
    transactionDate: todayFor(settings),
    accountId: source.accountId,
    destinationAccountId: source.destinationAccountId,
    categoryId: source.categoryId,
    description: source.description,
    merchant: source.merchant,
    paymentMethod: source.paymentMethod,
    notes: source.notes,
    location: source.location,
    tags: source.tags,
    status: "POSTED" as const,
    splits: source.splits.map((s) => ({ categoryId: s.categoryId, amount: Number(s.amount), note: s.note })),
  };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

export interface BulkResult {
  action: string;
  requested: number;
  processed: number;
  skipped: { id: string; reason: string }[];
  dryRun: boolean;
}

/**
 * Bulk actions with per-item validation and ONE atomic commit for the rows that
 * pass. Transfers are never moved as one side; refunds, reconciled rows and
 * purchases with refunds are skipped with a reason rather than bypassed.
 */
export async function bulkUpdateTransactions(
  userId: string,
  input: { action: "categorize" | "addTag" | "removeTag" | "moveAccount" | "delete"; ids: string[]; categoryId?: string; tag?: string; accountId?: string; dryRun: boolean }
): Promise<BulkResult> {
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, undefined, async (tx) => {
    const rows = await tx.transaction.findMany({
      where: { userId, id: { in: input.ids }, deletedAt: null },
      include: TX_INCLUDE,
      orderBy: { id: "asc" },
    });
    const found = new Set(rows.map((r) => r.id));
    const skipped: BulkResult["skipped"] = input.ids.filter((id) => !found.has(id)).map((id) => ({ id, reason: "Not found" }));
    let category: Awaited<ReturnType<typeof requireOwnedCategory>> = null;
    if (input.action === "categorize") category = await requireOwnedCategory(tx, userId, input.categoryId, "ANY");
    if (input.action === "moveAccount") await requireOwnedAccounts(tx, userId, [{ path: "accountId", id: input.accountId }]);

    const eligible = rows.filter((r) => {
      const skip = (reason: string) => (skipped.push({ id: r.id, reason }), false);
      switch (input.action) {
        case "categorize":
          if (r.type !== "EXPENSE" && r.type !== "INCOME") return skip("Only expenses and income have categories");
          if (r.isSplit) return skip("Split transactions are categorised per line");
          if (r.refunds.length) return skip("Has refunds allocated to its current category");
          if (category && category.type !== "BOTH" && category.type !== r.type) return skip(`Category doesn't apply to ${r.type.toLowerCase()}`);
          return r.categoryId !== category?.id || skip("Already in this category");
        case "addTag":
          return !r.tags.includes(input.tag!) || skip("Already tagged");
        case "removeTag":
          return r.tags.includes(input.tag!) || skip("Doesn't have this tag");
        case "moveAccount":
          if (r.type === "TRANSFER" || r.type === "ADJUSTMENT") return skip("Transfers and adjustments can't be moved as a whole");
          if (r.reconciledAt) return skip("Reconciled");
          return r.accountId !== input.accountId || skip("Already in this account");
        case "delete":
          if (r.refunds.length) return skip("Has refunds — delete it individually");
          if (r.reconciledAt) return skip("Reconciled — delete it individually to confirm");
          return true;
      }
    });

    if (input.dryRun) {
      return { action: input.action, requested: input.ids.length, processed: eligible.length, skipped, dryRun: true };
    }

    for (const r of eligible) {
      await tx.$queryRaw`SELECT "id" FROM "Transaction" WHERE "id" = ${r.id} FOR UPDATE`;
      if (input.action === "delete") {
        await softDelete(tx, userId, r);
        continue;
      }
      const data: Prisma.TransactionUpdateInput = { version: { increment: 1 } };
      if (input.action === "categorize") data.category = { connect: { id: category!.id } };
      if (input.action === "addTag") data.tags = [...r.tags, input.tag!];
      if (input.action === "removeTag") data.tags = r.tags.filter((t) => t !== input.tag);
      if (input.action === "moveAccount") data.account = { connect: { id: input.accountId! } };
      const updated = await tx.transaction.update({ where: { id: r.id }, data, include: TX_INCLUDE });
      if (input.action === "moveAccount") await applyEffects(tx, userId, effectsDiff(r, updated));
    }
    if (eligible.length) {
      await auditTx(tx, {
        userId,
        action: input.action === "delete" ? "TRANSACTION_DELETED" : "TRANSACTIONS_BULK_UPDATED",
        entity: "Transaction",
        metadata: { action: input.action, count: eligible.length },
      });
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          ...changedPayload(input.action === "delete" ? "deleted" : "updated", eligible, false),
          categoryIds: [...new Set([category?.id, ...eligible.map((e) => e.categoryId)].filter((x): x is string => !!x))],
          accountIds: [...new Set([input.accountId, ...eligible.flatMap((e) => [e.accountId, e.destinationAccountId])].filter((x): x is string => !!x))],
        })
      );
    }
    return { action: input.action, requested: input.ids.length, processed: eligible.length, skipped, dryRun: false };
  });
  await dispatchEvents(eventIds);
  return result.value;
}
