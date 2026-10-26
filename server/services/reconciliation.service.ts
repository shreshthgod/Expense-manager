import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { fromDbDate, fromDbDateOrNull, toDbDate, type ISODate } from "@/lib/dates/date-only";
import { fromMinor, toMinor } from "@/lib/utils/money";
import { runInTransaction } from "@/server/db/idempotency";
import { applyEffects, ledgerEffects } from "@/server/ledger/effects";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { balanceAsOf } from "@/server/services/account.service";
import { mapTransaction, TX_INCLUDE } from "@/server/services/transaction.service";
import type { TransactionDTO } from "@/server/services/transaction.types";

/**
 * Statement reconciliation:
 *   choose account + statement date → enter statement balance → compare with
 *   the app's balance AS OF that date → review unreconciled records → fix
 *   them through the normal flows → complete when the difference is zero, or
 *   (explicit consent) record a dated ADJUSTMENT for the remainder.
 * Completing marks every posted record up to the statement date as reconciled;
 * later changes inside that period reopen it (transaction.service).
 */

export interface ReconciliationWorkspace {
  id: string;
  accountId: string;
  accountName: string;
  statementDate: ISODate;
  statementBalance: number;
  /** App balance at the end of statementDate (live). */
  appBalance: number;
  difference: number;
  status: "IN_PROGRESS" | "COMPLETED" | "REOPENED";
  previous: { statementDate: ISODate; statementBalance: number } | null;
  unreconciled: TransactionDTO[];
  completedAt: string | null;
  reopenReason: string | null;
}

async function workspace(userId: string, id: string): Promise<ReconciliationWorkspace> {
  const rec = await prisma.reconciliation.findFirst({ where: { id, userId }, include: { account: { select: { name: true } } } });
  if (!rec) throw ApiError.notFound("Reconciliation not found");
  const statementDate = fromDbDate(rec.statementDate);
  const [appBalance, previous, unreconciled] = await Promise.all([
    balanceAsOf(prisma, userId, rec.accountId, statementDate),
    prisma.reconciliation.findFirst({
      where: { userId, accountId: rec.accountId, status: "COMPLETED", statementDate: { lt: rec.statementDate }, id: { not: rec.id } },
      orderBy: { statementDate: "desc" },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        status: "POSTED",
        reconciledAt: null,
        transactionDate: { lte: rec.statementDate },
        OR: [{ accountId: rec.accountId }, { destinationAccountId: rec.accountId }],
      },
      include: TX_INCLUDE,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
  ]);
  const statementBalance = Number(rec.statementBalance);
  return {
    id: rec.id,
    accountId: rec.accountId,
    accountName: rec.account.name,
    statementDate,
    statementBalance,
    appBalance,
    difference: fromMinor(toMinor(statementBalance) - toMinor(appBalance)),
    status: rec.status,
    previous: previous ? { statementDate: fromDbDate(previous.statementDate), statementBalance: Number(previous.statementBalance) } : null,
    unreconciled: unreconciled.map((t) => mapTransaction(t, rec.accountId)),
    completedAt: rec.completedAt?.toISOString() ?? null,
    reopenReason: rec.reopenReason,
  };
}

export async function startReconciliation(userId: string, input: { accountId: string; statementDate: ISODate; statementBalance: number }) {
  const account = await prisma.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw ApiError.field("accountId", "Account not found");
  const existing = await prisma.reconciliation.findFirst({
    where: { userId, accountId: input.accountId, status: "IN_PROGRESS" },
  });
  const rec = existing
    ? await prisma.reconciliation.update({
        where: { id: existing.id },
        data: { statementDate: toDbDate(input.statementDate), statementBalance: new Prisma.Decimal(input.statementBalance.toFixed(2)) },
      })
    : await prisma.reconciliation.create({
        data: {
          userId,
          accountId: input.accountId,
          statementDate: toDbDate(input.statementDate),
          statementBalance: new Prisma.Decimal(input.statementBalance.toFixed(2)),
          computedBalance: new Prisma.Decimal(0),
        },
      });
  return workspace(userId, rec.id);
}

export const getReconciliation = workspace;

export async function listReconciliations(userId: string, accountId?: string) {
  const rows = await prisma.reconciliation.findMany({
    where: { userId, ...(accountId ? { accountId } : {}) },
    include: { account: { select: { name: true } } },
    orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.account.name,
    statementDate: fromDbDate(r.statementDate),
    statementBalance: Number(r.statementBalance),
    computedBalance: Number(r.computedBalance),
    status: r.status,
    completedAt: r.completedAt?.toISOString() ?? null,
    reopenedAt: r.reopenedAt?.toISOString() ?? null,
    reopenReason: r.reopenReason,
    hasAdjustment: !!r.adjustmentTransactionId,
  }));
}

export async function completeReconciliation(userId: string, id: string, input: { createAdjustment: boolean; reason?: string | null }) {
  const eventIds: string[] = [];
  await runInTransaction(userId, undefined, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Reconciliation" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const rec = await tx.reconciliation.findFirst({ where: { id, userId } });
    if (!rec) throw ApiError.notFound("Reconciliation not found");
    if (rec.status === "COMPLETED") throw ApiError.rule("This reconciliation is already complete.", "ALREADY_COMPLETED");
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${rec.accountId} AND "userId" = ${userId} FOR UPDATE`;
    const statementDate = fromDbDate(rec.statementDate);
    const app = await balanceAsOf(tx, userId, rec.accountId, statementDate);
    const diffMinor = toMinor(rec.statementBalance.toString()) - toMinor(app);
    let adjustmentId: string | null = null;
    if (diffMinor !== 0) {
      if (!input.createAdjustment) {
        throw ApiError.rule(
          `The statement and the app differ by ${fromMinor(diffMinor).toFixed(2)}. Fix the missing or wrong records, or confirm a balance adjustment.`,
          "DIFFERENCE_REMAINS"
        );
      }
      const row = await tx.transaction.create({
        data: {
          userId,
          type: "ADJUSTMENT",
          status: "POSTED",
          amount: new Prisma.Decimal(fromMinor(Math.abs(diffMinor)).toFixed(2)),
          accountId: diffMinor < 0 ? rec.accountId : null,
          destinationAccountId: diffMinor > 0 ? rec.accountId : null,
          transactionDate: rec.statementDate,
          description: "Reconciliation adjustment",
          notes: input.reason ?? `Statement ${statementDate}`,
        },
      });
      await applyEffects(tx, userId, ledgerEffects(row));
      adjustmentId = row.id;
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          reason: "created",
          transactionIds: [row.id],
          dates: [statementDate],
          categoryIds: [],
          accountIds: [rec.accountId],
          newExpenseIds: [],
        })
      );
    }
    const now = new Date();
    await tx.transaction.updateMany({
      where: {
        userId,
        deletedAt: null,
        status: "POSTED",
        transactionDate: { lte: rec.statementDate },
        OR: [{ accountId: rec.accountId }, { destinationAccountId: rec.accountId }],
      },
      data: { reconciledAt: now, reconciliationId: rec.id },
    });
    await tx.reconciliation.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: now,
        computedBalance: new Prisma.Decimal(fromMinor(toMinor(app) + diffMinor).toFixed(2)),
        adjustmentTransactionId: adjustmentId,
        reopenReason: null,
      },
    });
    await tx.account.update({ where: { id: rec.accountId }, data: { lastReconciledAt: now } });
    await auditTx(tx, { userId, action: "RECONCILIATION_COMPLETED", entity: "Reconciliation", entityId: id, metadata: { adjusted: !!adjustmentId } });
  });
  await dispatchEvents(eventIds);
  return workspace(userId, id);
}

export async function cancelReconciliation(userId: string, id: string) {
  const rec = await prisma.reconciliation.findFirst({ where: { id, userId } });
  if (!rec) throw ApiError.notFound("Reconciliation not found");
  if (rec.status === "COMPLETED") throw ApiError.rule("Completed reconciliations are kept as history.", "ALREADY_COMPLETED");
  await prisma.reconciliation.delete({ where: { id } });
}

/** Accounts that have activity but no reconciliation in the last `days` days (review inbox). */
export async function accountsNeedingReconciliation(userId: string, days = 35) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const accounts = await prisma.account.findMany({
    where: { userId, archivedAt: null, OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: cutoff } }] },
    select: { id: true, name: true, lastReconciledAt: true, _count: { select: { transactions: true } } },
  });
  return accounts
    .filter((a) => a._count.transactions > 0)
    .map((a) => ({ id: a.id, name: a.name, lastReconciledAt: fromDbDateOrNull(a.lastReconciledAt) }));
}
