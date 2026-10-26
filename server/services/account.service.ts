import { Prisma, type Account, type AccountType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { accountTypeMeta, isLiabilityType, type AccountGroup } from "@/lib/constants";
import { addMoney, fromMinor, toMinor } from "@/lib/utils/money";
import { addMonthsClamped, daysInMonth, fromDbDate, fromDbDateOrNull, makeISODate, parseISODate, toDbDate, type ISODate } from "@/lib/dates/date-only";
import type { AccountCreateInput, AccountUpdateInput } from "@/lib/validation/schemas";
import { runInTransaction, type IdempotencyContext, type TxClient } from "@/server/db/idempotency";
import { applyEffects, ledgerEffects } from "@/server/ledger/effects";
import { POSTED_ACTIVE, signedEffectOn } from "@/server/ledger/sql";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export interface AccountDTO {
  id: string;
  name: string;
  type: AccountType;
  group: AccountGroup;
  liquid: boolean;
  /** Signed: negative on a liability means money owed. */
  balance: number;
  /** Liabilities only: amount owed (never negative). */
  outstanding: number | null;
  openingBalance: number;
  openingDate: ISODate | null;
  currency: string;
  institution: string | null;
  notes: string | null;
  includeInNetWorth: boolean;
  archived: boolean;
  version: number;
  createdAt: string;
  lastReconciledAt: string | null;
  /** Credit cards only. */
  card: {
    creditLimit: number | null;
    availableCredit: number | null;
    /** Share of the limit in use (0-100+). */
    utilization: number | null;
    statementDay: number | null;
    paymentDueDay: number | null;
    maskedNumber: string | null;
  } | null;
}

export function toAccountDTO(a: Account): AccountDTO {
  const meta = accountTypeMeta(a.type);
  const balance = Number(a.balance);
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    group: meta.group,
    liquid: meta.liquid,
    balance,
    outstanding: meta.group === "LIABILITY" ? Math.max(0, -balance) : null,
    openingBalance: Number(a.openingBalance),
    openingDate: fromDbDateOrNull(a.openingDate),
    currency: a.currency,
    institution: a.institution,
    notes: a.notes,
    includeInNetWorth: a.includeInNetWorth,
    archived: a.archivedAt != null,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    lastReconciledAt: a.lastReconciledAt?.toISOString() ?? null,
    card:
      a.type === "CREDIT_CARD"
        ? (() => {
            const limit = a.creditLimit != null ? Number(a.creditLimit) : null;
            const owed = Math.max(0, -balance);
            return {
              creditLimit: limit,
              availableCredit: limit != null ? fromMinor(toMinor(limit) - toMinor(owed)) : null,
              utilization: limit ? Math.round((owed / limit) * 1000) / 10 : null,
              statementDay: a.statementDay,
              paymentDueDay: a.paymentDueDay,
              maskedNumber: a.maskedNumber,
            };
          })()
        : null,
  };
}

export interface BalanceSummary {
  /** Cash you can spend today: bank, savings, cash and wallets. */
  liquid: number;
  totalAssets: number;
  /** Positive number: total owed across liability accounts. */
  totalLiabilities: number;
  netWorth: number;
  accountCount: number;
}

/**
 * Net worth = assets − liabilities = Σ signed balances of included accounts.
 * Archived accounts still count (archiving hides them from new entries only);
 * credit limits and planned transactions never count.
 */
export function summarizeBalances(accounts: Pick<AccountDTO, "type" | "balance" | "includeInNetWorth">[]): BalanceSummary {
  let liquid = 0;
  let assets = 0;
  let liabilities = 0;
  let count = 0;
  for (const a of accounts) {
    if (!a.includeInNetWorth) continue;
    count += 1;
    const minor = toMinor(a.balance);
    const meta = accountTypeMeta(a.type);
    if (meta.group === "LIABILITY") liabilities += -minor;
    else assets += minor;
    if (meta.liquid) liquid += minor;
  }
  return {
    liquid: fromMinor(liquid),
    totalAssets: fromMinor(assets),
    totalLiabilities: fromMinor(liabilities),
    netWorth: fromMinor(assets - liabilities),
    accountCount: count,
  };
}

export async function listAccounts(userId: string, opts: { includeArchived?: boolean } = {}): Promise<AccountDTO[]> {
  const rows = await prisma.account.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
  });
  return rows.map(toAccountDTO);
}

export async function getBalanceSummary(userId: string): Promise<BalanceSummary> {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { type: true, balance: true, includeInNetWorth: true },
  });
  return summarizeBalances(accounts.map((a) => ({ type: a.type, balance: Number(a.balance), includeInNetWorth: a.includeInNetWorth })));
}

export async function getAccountOrThrow(userId: string, id: string): Promise<Account> {
  const account = await prisma.account.findFirst({ where: { id, userId } });
  if (!account) throw ApiError.notFound("Account not found");
  return account;
}

export interface AccountDetailDTO extends AccountDTO {
  stats: {
    transactionCount: number;
    lastActivity: ISODate | null;
    inflowThisMonth: number;
    outflowThisMonth: number;
    plannedCount: number;
  };
}

export async function getAccountDetail(userId: string, id: string): Promise<AccountDetailDTO> {
  const account = await getAccountOrThrow(userId, id);
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [counts, flows] = await Promise.all([
    prisma.$queryRaw<{ count: bigint; planned: bigint; last: Date | null }[]>`
      SELECT COUNT(*) FILTER (WHERE t."status" = 'POSTED') AS count,
             COUNT(*) FILTER (WHERE t."status" = 'PLANNED') AS planned,
             MAX(t."transactionDate") FILTER (WHERE t."status" = 'POSTED') AS last
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL
        AND (t."accountId" = ${id} OR t."destinationAccountId" = ${id})`,
    prisma.$queryRaw<{ inflow: Prisma.Decimal | null; outflow: Prisma.Decimal | null }[]>`
      SELECT SUM(GREATEST(e.v, 0)) AS inflow, SUM(GREATEST(-e.v, 0)) AS outflow
      FROM (
        SELECT ${signedEffectOn(Prisma.sql`${id}`)} AS v
        FROM "Transaction" t
        WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
          AND (t."accountId" = ${id} OR t."destinationAccountId" = ${id})
          AND t."transactionDate" >= ${monthStart}::date
      ) e`,
  ]);
  const c = counts[0];
  return {
    ...toAccountDTO(account),
    stats: {
      transactionCount: Number(c?.count ?? 0),
      plannedCount: Number(c?.planned ?? 0),
      lastActivity: c?.last ? fromDbDate(c.last) : null,
      inflowThisMonth: Number(flows[0]?.inflow ?? 0),
      outflowThisMonth: Number(flows[0]?.outflow ?? 0),
    },
  };
}

async function assertUniqueName(tx: TxClient, userId: string, name: string, exceptId?: string) {
  const clash = await tx.account.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw ApiError.field("name", "You already have an account with this name");
}

export async function createAccount(
  userId: string,
  input: AccountCreateInput,
  opts: { idempotency?: IdempotencyContext; client?: TxClient } = {}
): Promise<{ account: AccountDTO; replayed: boolean }> {
  const settings = await getUserSettings(userId);
  if (input.currency && input.currency !== settings.currency) {
    throw ApiError.field(
      "currency",
      `Accounts use your base currency (${settings.currency}). Multi-currency accounts are not supported yet.`
    );
  }
  const openingDate = input.openingDate ?? todayFor(settings);
  const work = async (tx: TxClient) => {
    await assertUniqueName(tx, userId, input.name);
    const row = await tx.account.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        openingBalance: new Prisma.Decimal(input.openingBalance.toFixed(2)),
        balance: new Prisma.Decimal(input.openingBalance.toFixed(2)),
        openingDate: toDbDate(openingDate),
        currency: settings.currency,
        institution: input.institution ?? null,
        notes: input.notes ?? null,
        includeInNetWorth: input.includeInNetWorth,
        ...(input.type === "CREDIT_CARD"
          ? {
              creditLimit: input.creditLimit != null ? new Prisma.Decimal(input.creditLimit.toFixed(2)) : null,
              statementDay: input.statementDay ?? null,
              paymentDueDay: input.paymentDueDay ?? null,
              maskedNumber: input.maskedNumber ?? null,
            }
          : {}),
      },
    });
    await auditTx(tx, { userId, action: "ACCOUNT_CREATED", entity: "Account", entityId: row.id, metadata: { type: row.type } });
    return toAccountDTO(row);
  };
  if (opts.client) return { account: await work(opts.client), replayed: false };
  const result = await runInTransaction(userId, opts.idempotency, work);
  return { account: result.value, replayed: result.replayed };
}

async function activeTransactionCount(tx: TxClient, userId: string, accountId: string) {
  return tx.transaction.count({
    where: { userId, deletedAt: null, OR: [{ accountId }, { destinationAccountId: accountId }] },
  });
}

export async function updateAccount(userId: string, id: string, input: AccountUpdateInput): Promise<AccountDTO> {
  const result = await runInTransaction(userId, undefined, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const account = await tx.account.findFirst({ where: { id, userId } });
    if (!account) throw ApiError.notFound("Account not found");
    if (account.version !== input.version) throw ApiError.versionConflict("account");

    const data: Prisma.AccountUpdateInput = { version: { increment: 1 } };
    if (input.name != null && input.name !== account.name) {
      await assertUniqueName(tx, userId, input.name, id);
      data.name = input.name;
    }
    if (input.type != null && input.type !== account.type) {
      if (isLiabilityType(input.type) !== isLiabilityType(account.type)) {
        throw ApiError.field(
          "type",
          "Switching between an asset and a liability would flip the meaning of the balance. Create a new account instead."
        );
      }
      data.type = input.type;
    }
    if (input.institution !== undefined) data.institution = input.institution;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.includeInNetWorth !== undefined) data.includeInNetWorth = input.includeInNetWorth;
    const isCard = (input.type ?? account.type) === "CREDIT_CARD";
    if (isCard) {
      if (input.creditLimit !== undefined) data.creditLimit = input.creditLimit != null ? new Prisma.Decimal(input.creditLimit.toFixed(2)) : null;
      if (input.statementDay !== undefined) data.statementDay = input.statementDay;
      if (input.paymentDueDay !== undefined) data.paymentDueDay = input.paymentDueDay;
      if (input.maskedNumber !== undefined) data.maskedNumber = input.maskedNumber;
    }

    const openingChanged =
      (input.openingBalance !== undefined && toMinor(input.openingBalance) !== toMinor(account.openingBalance.toString())) ||
      (input.openingDate !== undefined && input.openingDate !== fromDbDateOrNull(account.openingDate));
    if (openingChanged) {
      const used = await activeTransactionCount(tx, userId, id);
      if (used > 0) {
        throw ApiError.rule(
          "This account already has transactions, so its opening balance is part of its history. Record a dated balance adjustment instead.",
          "OPENING_BALANCE_LOCKED",
          [{ path: ["openingBalance"], message: "Use “Adjust balance” for accounts with history" }]
        );
      }
      if (input.openingBalance !== undefined) {
        const delta = toMinor(input.openingBalance) - toMinor(account.openingBalance.toString());
        data.openingBalance = new Prisma.Decimal(input.openingBalance.toFixed(2));
        data.balance = { increment: new Prisma.Decimal(fromMinor(delta).toFixed(2)) };
      }
      if (input.openingDate !== undefined) data.openingDate = toDbDate(input.openingDate);
    }

    if (input.archived !== undefined && input.archived !== (account.archivedAt != null)) {
      if (input.archived) {
        const activeRules = await tx.recurringTransaction.count({ where: { userId, accountId: id, active: true } });
        if (activeRules > 0) {
          throw ApiError.rule(
            `${activeRules} active recurring item(s) still pay from or into this account. Pause them or move them to another account first.`,
            "ACCOUNT_HAS_SCHEDULES"
          );
        }
        await tx.userPreference.updateMany({ where: { userId, defaultAccountId: id }, data: { defaultAccountId: null } });
        data.archivedAt = new Date();
      } else {
        data.archivedAt = null;
      }
    }

    const row = await tx.account.update({ where: { id }, data });
    await auditTx(tx, {
      userId,
      action: input.archived === true ? "ACCOUNT_ARCHIVED" : "ACCOUNT_UPDATED",
      entity: "Account",
      entityId: id,
    });
    return toAccountDTO(row);
  });
  return result.value;
}

/**
 * Hard delete is only allowed for accounts without financial history.
 * Accounts with history are archived instead (history, net worth preserved).
 */
export async function deleteAccount(userId: string, id: string): Promise<void> {
  await runInTransaction(userId, undefined, async (tx) => {
    const account = await tx.account.findFirst({ where: { id, userId } });
    if (!account) throw ApiError.notFound("Account not found");
    const [active, rules] = await Promise.all([
      activeTransactionCount(tx, userId, id),
      tx.recurringTransaction.count({ where: { userId, accountId: id } }),
    ]);
    if (active > 0 || rules > 0) {
      throw ApiError.rule(
        `This account has ${active} transaction(s)${rules ? ` and ${rules} recurring item(s)` : ""}. Deleting it would erase financial history — archive it instead.`,
        "ACCOUNT_HAS_HISTORY"
      );
    }
    // Soft-deleted rows can no longer be restored without their account.
    await tx.transaction.deleteMany({
      where: { userId, deletedAt: { not: null }, OR: [{ accountId: id }, { destinationAccountId: id }] },
    });
    await tx.userPreference.updateMany({ where: { userId, defaultAccountId: id }, data: { defaultAccountId: null } });
    await tx.account.delete({ where: { id } });
    await auditTx(tx, { userId, action: "ACCOUNT_DELETED", entity: "Account", entityId: id });
  });
}

/** Ledger balance of an account at the end of `date` (opening + posted effects up to date). */
export async function balanceAsOf(client: TxClient | typeof prisma, userId: string, accountId: string, date: ISODate): Promise<number> {
  const rows = await client.$queryRaw<{ opening: Prisma.Decimal; effects: Prisma.Decimal | null }[]>`
    SELECT a."openingBalance" AS opening,
           (SELECT SUM(${signedEffectOn(Prisma.sql`a."id"`)})
              FROM "Transaction" t
             WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
               AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
               AND t."transactionDate" <= ${date}::date) AS effects
    FROM "Account" a WHERE a."id" = ${accountId} AND a."userId" = ${userId}`;
  const row = rows[0];
  if (!row) throw ApiError.notFound("Account not found");
  return addMoney(row.opening.toString(), (row.effects ?? 0).toString());
}

/**
 * Correction flow: records an explicit, dated ADJUSTMENT so that the account's
 * balance as of `date` equals `targetBalance`. History is never rewritten.
 */
export async function adjustAccountBalance(
  userId: string,
  accountId: string,
  input: { targetBalance: number; date: ISODate; reason: string },
  opts: { idempotency?: IdempotencyContext } = {}
): Promise<{ adjusted: boolean; delta: number; transactionId: string | null }> {
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId} AND "userId" = ${userId} FOR UPDATE`;
    const account = await tx.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw ApiError.notFound("Account not found");
    const current = await balanceAsOf(tx, userId, accountId, input.date);
    const deltaMinor = toMinor(input.targetBalance) - toMinor(current);
    if (deltaMinor === 0) return { adjusted: false, delta: 0, transactionId: null };
    const row = await tx.transaction.create({
      data: {
        userId,
        type: "ADJUSTMENT",
        status: "POSTED",
        amount: new Prisma.Decimal(fromMinor(Math.abs(deltaMinor)).toFixed(2)),
        accountId: deltaMinor < 0 ? accountId : null,
        destinationAccountId: deltaMinor > 0 ? accountId : null,
        transactionDate: toDbDate(input.date),
        description: "Balance adjustment",
        notes: input.reason,
      },
    });
    await applyEffects(tx, userId, ledgerEffects(row));
    await auditTx(tx, {
      userId,
      action: "ACCOUNT_ADJUSTED",
      entity: "Account",
      entityId: accountId,
      metadata: { transactionId: row.id, delta: fromMinor(deltaMinor) },
    });
    eventIds.push(
      await enqueueEvent(tx, userId, "transactions.changed", {
        reason: "created",
        transactionIds: [row.id],
        dates: [input.date],
        categoryIds: [],
        accountIds: [accountId],
        newExpenseIds: [],
      })
    );
    return { adjusted: true, delta: fromMinor(deltaMinor), transactionId: row.id };
  });
  if (!result.replayed) await dispatchEvents(eventIds);
  return result.value;
}

/**
 * Integrity check: recomputes every balance from the ledger and reports
 * drift (should always be empty). Used by tests, restore and the scheduler.
 */
export async function verifyLedger(userId: string): Promise<{ accountId: string; stored: number; computed: number }[]> {
  const rows = await prisma.$queryRaw<{ id: string; stored: Prisma.Decimal; computed: Prisma.Decimal }[]>`
    SELECT a."id", a."balance" AS stored,
           a."openingBalance" + COALESCE((
             SELECT SUM(${signedEffectOn(Prisma.sql`a."id"`)})
             FROM "Transaction" t
             WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
               AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
           ), 0) AS computed
    FROM "Account" a WHERE a."userId" = ${userId}`;
  return rows
    .map((r) => ({ accountId: r.id, stored: Number(r.stored), computed: Number(r.computed) }))
    .filter((r) => toMinor(r.stored) !== toMinor(r.computed));
}

/** Repairs drift by rewriting balance = opening + Σ effects (restore/import safety net). */
export async function rebuildBalances(tx: TxClient, userId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Account" a SET "balance" = a."openingBalance" + COALESCE((
      SELECT SUM(${signedEffectOn(Prisma.sql`a."id"`)})
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
        AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
    ), 0)
    WHERE a."userId" = ${userId}`;
}


export interface CardStatement {
  accountId: string;
  /** Last completed statement date (null when no statement day is set). */
  lastStatementDate: ISODate | null;
  /** Amount owed at the last statement date. */
  statementBalance: number;
  /** Payments/credits received since that statement. */
  paidSinceStatement: number;
  /** Statement balance still unpaid (never negative). */
  amountDue: number;
  nextDueDate: ISODate | null;
  outstandingNow: number;
}

/**
 * Credit-card statement view. Uses only recorded data: the balance owed as of
 * the last statement date, minus payments into the card since then. No
 * interest/minimum-due is invented.
 */
export async function getCardStatement(userId: string, accountId: string): Promise<CardStatement> {
  const account = await getAccountOrThrow(userId, accountId);
  if (account.type !== "CREDIT_CARD") throw ApiError.rule("Statements are only available for credit cards.", "NOT_A_CARD");
  const today = todayFor(await getUserSettings(userId));
  const outstandingNow = Math.max(0, -Number(account.balance));
  if (!account.statementDay) {
    return { accountId, lastStatementDate: null, statementBalance: outstandingNow, paidSinceStatement: 0, amountDue: outstandingNow, nextDueDate: null, outstandingNow };
  }
  const { year, month, day } = parseISODate(today);
  const clampDay = (y: number, m: number, dd: number) => makeISODate(y, m, Math.min(dd, daysInMonth(y, m)));
  let statement = clampDay(year, month, account.statementDay);
  if (statement > today || (statement === today && day < account.statementDay)) {
    const prev = addMonthsClamped(makeISODate(year, month, 1), -1, 1);
    const p = parseISODate(prev);
    statement = clampDay(p.year, p.month, account.statementDay);
  }
  const statementBalance = Math.max(0, -(await balanceAsOf(prisma, userId, accountId, statement)));
  const paid = await prisma.$queryRaw<{ paid: Prisma.Decimal | null }[]>`
    SELECT SUM(t."amount") AS paid FROM "Transaction" t
    WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
      AND ((t."destinationAccountId" = ${accountId} AND t."type"::text IN ('TRANSFER','ADJUSTMENT'))
        OR (t."accountId" = ${accountId} AND t."type"::text IN ('REFUND','INCOME')))
      AND t."transactionDate" > ${statement}::date`;
  const paidSinceStatement = Number(paid[0]?.paid ?? 0);
  let nextDueDate: ISODate | null = null;
  if (account.paymentDueDay) {
    const s = parseISODate(statement);
    // Due date is the first paymentDueDay after the statement date.
    let due = clampDay(s.year, s.month, account.paymentDueDay);
    if (due <= statement) {
      const n = parseISODate(addMonthsClamped(makeISODate(s.year, s.month, 1), 1, 1));
      due = clampDay(n.year, n.month, account.paymentDueDay);
    }
    nextDueDate = due;
  }
  return {
    accountId,
    lastStatementDate: statement,
    statementBalance,
    paidSinceStatement,
    amountDue: Math.max(0, fromMinor(toMinor(statementBalance) - toMinor(paidSinceStatement))),
    nextDueDate,
    outstandingNow,
  };
}
