import { Prisma, type SavingsGoal } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, addMonthsClamped, diffDays, fromDbDate, fromDbDateOrNull, toDbDate, type ISODate } from "@/lib/dates/date-only";
import { fromMinor, round2, toMinor } from "@/lib/utils/money";
import type { GoalCreateInput, GoalUpdateInput } from "@/lib/validation/schemas";
import { runInTransaction, type IdempotencyContext, type TxClient } from "@/server/db/idempotency";
import { applyEffects, ledgerEffects } from "@/server/ledger/effects";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export type GoalKindValue = "SAVINGS" | "SINKING_FUND" | "EMERGENCY_FUND";

export interface GoalStatus {
  id: string;
  name: string;
  kind: GoalKindValue;
  targetAmount: number;
  /** Σ contributions (earmarked money). Never negative. */
  currentAmount: number;
  remainingAmount: number;
  progressPct: number;
  /** Stored deadline. */
  deadline: ISODate | null;
  /** Deadline used for calculations (sinking funds that repeat roll forward yearly). */
  effectiveDeadline: ISODate | null;
  daysRemaining: number | null;
  overdue: boolean;
  completed: boolean;
  requiredMonthlySaving: number | null;
  /** Planned monthly contribution, if set. */
  monthlyContribution: number | null;
  /** Monthly pace used for the projection (planned, else recent 90-day average). */
  pace: number | null;
  paceSource: "planned" | "recent" | null;
  /** Month the goal is expected to be reached at the current pace. */
  expectedCompletion: ISODate | null;
  /** null when there's no deadline or no pace to judge by. */
  onTrack: boolean | null;
  accountId: string | null;
  accountName: string | null;
  repeatsYearly: boolean;
  archived: boolean;
  completedAt: string | null;
  category: string | null;
  description: string | null;
  version: number;
  createdAt: string;
}

type GoalCore = Pick<SavingsGoal, "id" | "name" | "targetAmount" | "currentAmount" | "deadline" | "category" | "description" | "version" | "createdAt">;
type GoalExtras = Partial<Pick<SavingsGoal, "kind" | "accountId" | "monthlyContribution" | "repeatsYearly" | "archivedAt" | "completedAt">>;

/** Sinking funds that repeat yearly move their deadline forward until it's not in the past. */
export function effectiveDeadlineOf(deadline: ISODate | null, repeatsYearly: boolean, today: ISODate): ISODate | null {
  if (!deadline || !repeatsYearly) return deadline;
  let d = deadline;
  let guard = 0;
  while (d < today && guard++ < 200) d = addMonthsClamped(d, 12);
  return d;
}

/**
 * Pure goal maths (date-only, deterministic):
 *   remaining   = max(0, target − current)
 *   progress    = min(100, current / target × 100)
 *   required/mo = remaining / max(1, ceil(daysRemaining / 30))   (only with a future deadline)
 *   expected    = today + ceil(remaining / pace) months          (only with a positive pace)
 */
export function mapGoal(
  goal: GoalCore & GoalExtras,
  today: ISODate,
  extras: { recentMonthlyPace?: number | null; accountName?: string | null } = {}
): GoalStatus {
  const target = Number(goal.targetAmount);
  const current = Number(goal.currentAmount);
  const remainingAmount = fromMinor(Math.max(0, toMinor(target) - toMinor(current)));
  const progressPct = target > 0 ? Math.min(100, round2((current / target) * 100)) : 0;
  const deadline = fromDbDateOrNull(goal.deadline);
  const repeatsYearly = goal.repeatsYearly ?? false;
  const effectiveDeadline = effectiveDeadlineOf(deadline, repeatsYearly, today);
  const daysRemaining = effectiveDeadline ? diffDays(today, effectiveDeadline) : null;
  const overdue = daysRemaining != null && daysRemaining < 0 && remainingAmount > 0;
  const requiredMonthlySaving =
    daysRemaining != null && daysRemaining > 0 && remainingAmount > 0
      ? round2(remainingAmount / Math.max(1, Math.ceil(daysRemaining / 30)))
      : null;
  const planned = goal.monthlyContribution != null ? Number(goal.monthlyContribution) : null;
  const recent = extras.recentMonthlyPace != null && extras.recentMonthlyPace > 0 ? extras.recentMonthlyPace : null;
  const pace = planned && planned > 0 ? planned : recent;
  const paceSource = planned && planned > 0 ? "planned" : recent ? "recent" : null;
  const completed = target > 0 && remainingAmount <= 0;
  const expectedCompletion = completed ? today : pace ? addMonthsClamped(today, Math.ceil(remainingAmount / pace)) : null;
  const onTrack = completed ? true : effectiveDeadline && expectedCompletion ? expectedCompletion <= effectiveDeadline : null;
  return {
    id: goal.id,
    name: goal.name,
    kind: (goal.kind ?? "SAVINGS") as GoalKindValue,
    targetAmount: target,
    currentAmount: current,
    remainingAmount,
    progressPct,
    deadline,
    effectiveDeadline,
    daysRemaining,
    overdue,
    completed,
    requiredMonthlySaving,
    monthlyContribution: planned,
    pace: pace != null ? round2(pace) : null,
    paceSource,
    expectedCompletion,
    onTrack,
    accountId: goal.accountId ?? null,
    accountName: extras.accountName ?? null,
    repeatsYearly,
    archived: goal.archivedAt != null,
    completedAt: goal.completedAt?.toISOString() ?? null,
    category: goal.category,
    description: goal.description,
    version: goal.version,
    createdAt: goal.createdAt.toISOString(),
  };
}

/** Net contributions per goal over the last 90 days, expressed per month. */
async function recentPaces(userId: string, today: ISODate): Promise<Map<string, number>> {
  const since = addDays(today, -90);
  const rows = await prisma.goalContribution.groupBy({
    by: ["goalId"],
    where: { userId, date: { gt: toDbDate(since), lte: toDbDate(today) } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.goalId, round2(Number(r._sum.amount ?? 0) / 3)]));
}

export async function listGoals(userId: string, today?: ISODate, opts: { includeArchived?: boolean } = {}): Promise<GoalStatus[]> {
  const day = today ?? todayFor(await getUserSettings(userId));
  const [goals, paces] = await Promise.all([
    prisma.savingsGoal.findMany({
      where: { userId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ createdAt: "asc" }],
    }),
    recentPaces(userId, day),
  ]);
  const accountIds = [...new Set(goals.map((g) => g.accountId).filter((x): x is string => !!x))];
  const accounts = accountIds.length
    ? await prisma.account.findMany({ where: { userId, id: { in: accountIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return goals.map((g) => mapGoal(g, day, { recentMonthlyPace: paces.get(g.id) ?? null, accountName: g.accountId ? names.get(g.accountId) ?? null : null }));
}

export async function getGoalStatus(userId: string, id: string): Promise<GoalStatus & { warnings: string[] }> {
  const day = todayFor(await getUserSettings(userId));
  const goal = await prisma.savingsGoal.findFirst({ where: { id, userId } });
  if (!goal) throw ApiError.notFound("Goal not found");
  const paces = await recentPaces(userId, day);
  const account = goal.accountId ? await prisma.account.findFirst({ where: { id: goal.accountId, userId }, select: { name: true } }) : null;
  return {
    ...mapGoal(goal, day, { recentMonthlyPace: paces.get(id) ?? null, accountName: account?.name ?? null }),
    warnings: await overAllocationWarnings(userId, goal.accountId),
  };
}

/**
 * Earmarks are allocations of money already held. When the goals linked to an
 * account together claim more than the account holds, warn (never block).
 */
export async function overAllocationWarnings(userId: string, accountId: string | null): Promise<string[]> {
  if (!accountId) return [];
  const [account, sum] = await Promise.all([
    prisma.account.findFirst({ where: { id: accountId, userId }, select: { name: true, balance: true } }),
    prisma.savingsGoal.aggregate({ where: { userId, accountId, archivedAt: null }, _sum: { currentAmount: true } }),
  ]);
  if (!account) return [];
  const earmarked = Number(sum._sum.currentAmount ?? 0);
  const balance = Number(account.balance);
  return earmarked > balance
    ? [`Goals linked to ${account.name} claim ${earmarked.toFixed(2)}, but the account holds ${balance.toFixed(2)}. Some earmarked money isn't actually there.`]
    : [];
}

async function requireAccount(tx: TxClient, userId: string, id: string | null | undefined, field: string) {
  if (!id) return null;
  const account = await tx.account.findFirst({ where: { id, userId } });
  if (!account) throw ApiError.field(field, "Account not found");
  if (account.archivedAt) throw ApiError.field(field, "This account is archived");
  return account;
}

/** Keeps currentAmount = Σ contributions and completedAt in sync. */
async function recomputeGoal(tx: TxClient, goalId: string) {
  const sum = await tx.goalContribution.aggregate({ where: { goalId }, _sum: { amount: true } });
  const current = Number(sum._sum.amount ?? 0);
  const goal = await tx.savingsGoal.findUniqueOrThrow({ where: { id: goalId } });
  const done = Number(goal.targetAmount) > 0 && toMinor(current) >= toMinor(goal.targetAmount.toString());
  await tx.savingsGoal.update({
    where: { id: goalId },
    data: {
      currentAmount: new Prisma.Decimal(current.toFixed(2)),
      completedAt: done ? goal.completedAt ?? new Date() : null,
      version: { increment: 1 },
    },
  });
  return { current, target: Number(goal.targetAmount), wasCompleted: goal.completedAt != null, done };
}

export async function createGoal(
  userId: string,
  input: GoalCreateInput,
  opts: { idempotency?: IdempotencyContext; client?: TxClient; today?: ISODate } = {}
) {
  const work = async (tx: TxClient) => {
    await requireAccount(tx, userId, input.accountId, "accountId");
    const row = await tx.savingsGoal.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind ?? "SAVINGS",
        targetAmount: new Prisma.Decimal(input.targetAmount.toFixed(2)),
        currentAmount: new Prisma.Decimal(0),
        deadline: input.deadline ? toDbDate(input.deadline) : null,
        category: input.category ?? null,
        description: input.description ?? null,
        accountId: input.accountId ?? null,
        monthlyContribution: input.monthlyContribution != null ? new Prisma.Decimal(input.monthlyContribution.toFixed(2)) : null,
        repeatsYearly: input.repeatsYearly ?? false,
      },
    });
    if (input.currentAmount > 0) {
      const today = opts.today ?? todayFor(await getUserSettings(userId));
      await tx.goalContribution.create({
        data: { userId, goalId: row.id, amount: new Prisma.Decimal(input.currentAmount.toFixed(2)), date: toDbDate(today), note: "Already saved" },
      });
      await recomputeGoal(tx, row.id);
    }
    await auditTx(tx, { userId, action: "GOAL_CREATED", entity: "SavingsGoal", entityId: row.id });
    return { id: row.id };
  };
  const created = opts.client ? await work(opts.client) : (await runInTransaction(userId, opts.idempotency, work)).value;
  return opts.client ? created : getGoalStatus(userId, created.id);
}

export async function updateGoal(userId: string, id: string, input: GoalUpdateInput) {
  await runInTransaction(userId, undefined, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SavingsGoal" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const existing = await tx.savingsGoal.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("Goal not found");
    if (existing.version !== input.version) throw ApiError.versionConflict("goal");
    if (input.accountId !== undefined && input.accountId !== existing.accountId) await requireAccount(tx, userId, input.accountId, "accountId");
    await tx.savingsGoal.update({
      where: { id },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.kind != null ? { kind: input.kind } : {}),
        ...(input.targetAmount != null ? { targetAmount: new Prisma.Decimal(input.targetAmount.toFixed(2)) } : {}),
        // `null` clears the deadline; `undefined` leaves it unchanged. Never 1970.
        ...(input.deadline !== undefined ? { deadline: input.deadline ? toDbDate(input.deadline) : null } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        ...(input.monthlyContribution !== undefined
          ? { monthlyContribution: input.monthlyContribution != null ? new Prisma.Decimal(input.monthlyContribution.toFixed(2)) : null }
          : {}),
        ...(input.repeatsYearly !== undefined ? { repeatsYearly: input.repeatsYearly } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? existing.archivedAt ?? new Date() : null } : {}),
      },
    });
    // Target changes can complete or un-complete the goal.
    await recomputeGoal(tx, id);
    await auditTx(tx, { userId, action: "GOAL_UPDATED", entity: "SavingsGoal", entityId: id });
  });
  return getGoalStatus(userId, id);
}

export interface ContributionDTO {
  id: string;
  goalId: string;
  amount: number;
  date: ISODate;
  note: string | null;
  transactionId: string | null;
  createdAt: string;
}

export async function listContributions(userId: string, goalId: string): Promise<ContributionDTO[]> {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw ApiError.notFound("Goal not found");
  const rows = await prisma.goalContribution.findMany({ where: { userId, goalId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 });
  return rows.map((r) => ({
    id: r.id,
    goalId: r.goalId,
    amount: Number(r.amount),
    date: fromDbDate(r.date),
    note: r.note,
    transactionId: r.transactionId,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Adds money to (positive) or releases money from (negative) a goal.
 *   earmark  – money already held is set aside; no account balance changes.
 *   transfer – a real TRANSFER from `fromAccountId` to `toAccountId` is posted
 *              in the same database transaction and linked to the contribution.
 * The saved amount can never go below zero.
 */
export async function contributeToGoal(
  userId: string,
  id: string,
  input: { amount: number; date?: ISODate; note?: string | null; mode?: "earmark" | "transfer"; fromAccountId?: string | null; toAccountId?: string | null },
  opts: { idempotency?: IdempotencyContext } = {}
) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const date = input.date ?? today;
  if (date > today) throw ApiError.field("date", "Contributions can't be dated in the future");
  const eventIds: string[] = [];
  const result = await runInTransaction(userId, opts.idempotency, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SavingsGoal" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const goal = await tx.savingsGoal.findFirst({ where: { id, userId } });
    if (!goal) throw ApiError.notFound("Goal not found");
    if (goal.archivedAt) throw ApiError.rule("This goal is archived. Unarchive it to add money.", "GOAL_ARCHIVED");
    const next = toMinor(goal.currentAmount.toString()) + toMinor(input.amount);
    if (next < 0) {
      throw ApiError.field("amount", `You can release at most ${fromMinor(toMinor(goal.currentAmount.toString())).toFixed(2)} from this goal`);
    }
    let transactionId: string | null = null;
    if (input.mode === "transfer") {
      const from = await requireAccount(tx, userId, input.fromAccountId, "fromAccountId");
      const to = await requireAccount(tx, userId, input.toAccountId, "toAccountId");
      if (!from || !to) throw ApiError.field("fromAccountId", "Choose both accounts");
      if (from.currency !== to.currency) throw ApiError.field("toAccountId", "Both accounts must use the same currency");
      const row = await tx.transaction.create({
        data: {
          userId,
          type: "TRANSFER",
          status: "POSTED",
          amount: new Prisma.Decimal(Math.abs(input.amount).toFixed(2)),
          accountId: from.id,
          destinationAccountId: to.id,
          transactionDate: toDbDate(date),
          description: input.amount > 0 ? `Saved for ${goal.name}` : `Released from ${goal.name}`,
          notes: input.note ?? null,
          tags: ["goal"],
        },
      });
      await applyEffects(tx, userId, ledgerEffects(row));
      transactionId = row.id;
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          reason: "created",
          transactionIds: [row.id],
          dates: [date],
          categoryIds: [],
          accountIds: [from.id, to.id],
          newExpenseIds: [],
        })
      );
    }
    await tx.goalContribution.create({
      data: {
        userId,
        goalId: id,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        date: toDbDate(date),
        note: input.note ?? null,
        transactionId,
      },
    });
    const state = await recomputeGoal(tx, id);
    if (input.amount > 0 || state.done !== state.wasCompleted) {
      eventIds.push(await enqueueEvent(tx, userId, "goal.changed", { goalId: id }));
    }
    await auditTx(tx, {
      userId,
      action: "GOAL_CONTRIBUTION",
      entity: "SavingsGoal",
      entityId: id,
      metadata: { amount: input.amount, mode: input.mode ?? "earmark", transactionId },
    });
    return { id, transactionId };
  });
  if (!result.replayed) await dispatchEvents(eventIds);
  return { ...(await getGoalStatus(userId, id)), transactionId: result.value.transactionId };
}

/**
 * Removes a contribution from the goal's history. A linked transfer is left
 * untouched (it's a real money movement); the response says so.
 */
export async function deleteContribution(userId: string, goalId: string, contributionId: string) {
  const warnings: string[] = [];
  await runInTransaction(userId, undefined, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "SavingsGoal" WHERE "id" = ${goalId} AND "userId" = ${userId} FOR UPDATE`;
    const row = await tx.goalContribution.findFirst({ where: { id: contributionId, goalId, userId } });
    if (!row) throw ApiError.notFound("Contribution not found");
    const goal = await tx.savingsGoal.findUniqueOrThrow({ where: { id: goalId } });
    if (toMinor(goal.currentAmount.toString()) - toMinor(row.amount.toString()) < 0) {
      throw ApiError.rule("Removing this entry would make the saved amount negative. Remove the later releases first.", "GOAL_NEGATIVE");
    }
    await tx.goalContribution.delete({ where: { id: row.id } });
    await recomputeGoal(tx, goalId);
    if (row.transactionId) warnings.push("The linked transfer was kept. Delete it from Transactions if the money didn't actually move.");
    await auditTx(tx, { userId, action: "GOAL_CONTRIBUTION", entity: "SavingsGoal", entityId: goalId, metadata: { removed: row.id } });
  });
  return { ...(await getGoalStatus(userId, goalId)), warnings };
}

export async function deleteGoal(userId: string, id: string): Promise<void> {
  await runInTransaction(userId, undefined, async (tx) => {
    const deleted = await tx.savingsGoal.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw ApiError.notFound("Goal not found");
    await auditTx(tx, { userId, action: "GOAL_DELETED", entity: "SavingsGoal", entityId: id });
  });
}

/** Invariant check used by tests and the ledger verifier: currentAmount = Σ contributions. */
export async function verifyGoalLedger(userId: string): Promise<{ goalId: string; stored: number; computed: number }[]> {
  const rows = await prisma.$queryRaw<{ goalId: string; stored: Prisma.Decimal; computed: Prisma.Decimal | null }[]>`
    SELECT g."id" AS "goalId", g."currentAmount" AS stored, COALESCE(SUM(c."amount"), 0) AS computed
    FROM "SavingsGoal" g LEFT JOIN "GoalContribution" c ON c."goalId" = g."id"
    WHERE g."userId" = ${userId}
    GROUP BY g."id"
    HAVING g."currentAmount" <> COALESCE(SUM(c."amount"), 0)`;
  return rows.map((r) => ({ goalId: r.goalId, stored: Number(r.stored), computed: Number(r.computed ?? 0) }));
}
