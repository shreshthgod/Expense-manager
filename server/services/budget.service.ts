import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { fromDbDate, fromDbDateOrNull, toDbDate } from "@/lib/dates/date-only";
import {
  budgetShapeIssues,
  type BudgetCreateInput,
  type BudgetUpdateInput,
} from "@/lib/validation/schemas";
import { runInTransaction, type IdempotencyContext, type TxClient } from "@/server/db/idempotency";
import { getBudgetStatuses, type BudgetStatus } from "@/server/analytics/budget-status";
import { requireOwnedCategory } from "@/server/services/ownership";
import { auditTx } from "@/server/services/audit.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export async function listBudgets(userId: string, opts: { includeEnded?: boolean } = {}): Promise<BudgetStatus[]> {
  const settings = await getUserSettings(userId);
  return getBudgetStatuses(userId, todayFor(settings), {
    weekStartsOn: settings.weekStartsOn,
    includeEnded: opts.includeEnded ?? true,
  });
}

export async function getBudgetStatus(userId: string, id: string): Promise<BudgetStatus> {
  const settings = await getUserSettings(userId);
  const [status] = await getBudgetStatuses(userId, todayFor(settings), {
    weekStartsOn: settings.weekStartsOn,
    includeEnded: true,
    budgetIds: [id],
  });
  if (!status) throw ApiError.notFound("Budget not found");
  return status;
}

/**
 * Duplicate rule: two budgets for the same scope (same category, or both
 * "all spending") and the same period may not overlap in time. An overall
 * budget and a category budget may coexist — they monitor different scopes and
 * their usage is never added together.
 */
async function assertNoOverlap(
  tx: TxClient,
  userId: string,
  candidate: { period: string; startDate: string; endDate: string | null; categoryId: string | null },
  exceptId?: string
) {
  const others = await tx.budget.findMany({
    where: {
      userId,
      period: candidate.period as Prisma.EnumBudgetPeriodFilter["equals"],
      categoryId: candidate.categoryId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { name: true, startDate: true, endDate: true },
  });
  const cStart = candidate.startDate;
  const cEnd = candidate.endDate ?? "9999-12-31";
  const clash = others.find((o) => {
    const oStart = fromDbDate(o.startDate);
    const oEnd = fromDbDateOrNull(o.endDate) ?? "9999-12-31";
    return oStart <= cEnd && cStart <= oEnd;
  });
  if (clash) {
    throw ApiError.validation([
      {
        path: ["categoryId"],
        message: `"${clash.name}" already covers this ${candidate.categoryId ? "category" : "overall spending"} for an overlapping ${candidate.period.toLowerCase()} period. Edit that budget instead.`,
      },
    ]);
  }
}

export async function createBudget(
  userId: string,
  input: BudgetCreateInput,
  opts: { idempotency?: IdempotencyContext; client?: TxClient } = {}
) {
  const work = async (tx: TxClient) => {
    await requireOwnedCategory(tx, userId, input.categoryId, "EXPENSE");
    const endDate = input.endDate ?? null;
    await assertNoOverlap(tx, userId, { period: input.period, startDate: input.startDate, endDate, categoryId: input.categoryId ?? null });
    const row = await tx.budget.create({
      data: {
        userId,
        name: input.name,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        period: input.period,
        startDate: toDbDate(input.startDate),
        endDate: endDate ? toDbDate(endDate) : null,
        categoryId: input.categoryId ?? null,
        rolloverMode: input.rolloverMode ?? "NONE",
      },
    });
    await auditTx(tx, { userId, action: "BUDGET_CREATED", entity: "Budget", entityId: row.id });
    return { id: row.id };
  };
  const created = opts.client ? await work(opts.client) : (await runInTransaction(userId, opts.idempotency, work)).value;
  return opts.client ? created : getBudgetStatus(userId, created.id);
}

export async function updateBudget(userId: string, id: string, input: BudgetUpdateInput) {
  await runInTransaction(userId, undefined, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
    const existing = await tx.budget.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("Budget not found");
    if (existing.version !== input.version) throw ApiError.versionConflict("budget");
    const merged = {
      period: input.period ?? existing.period,
      startDate: input.startDate ?? fromDbDate(existing.startDate),
      endDate: input.endDate !== undefined ? input.endDate : fromDbDateOrNull(existing.endDate),
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
    };
    const issues = budgetShapeIssues(merged);
    if (issues.length) throw ApiError.validation(issues);
    if (merged.categoryId !== existing.categoryId) {
      await requireOwnedCategory(tx, userId, merged.categoryId, "EXPENSE");
    }
    await assertNoOverlap(tx, userId, merged, id);
    await tx.budget.update({
      where: { id },
      data: {
        ...(input.name != null ? { name: input.name } : {}),
        ...(input.amount != null ? { amount: new Prisma.Decimal(input.amount.toFixed(2)) } : {}),
        period: merged.period,
        startDate: toDbDate(merged.startDate),
        endDate: merged.endDate ? toDbDate(merged.endDate) : null,
        categoryId: merged.categoryId ?? null,
        ...(input.rolloverMode ? { rolloverMode: input.rolloverMode } : {}),
        version: { increment: 1 },
      },
    });
    await auditTx(tx, { userId, action: "BUDGET_UPDATED", entity: "Budget", entityId: id });
  });
  return getBudgetStatus(userId, id);
}

export async function deleteBudget(userId: string, id: string): Promise<void> {
  await runInTransaction(userId, undefined, async (tx) => {
    const deleted = await tx.budget.deleteMany({ where: { id, userId } });
    if (deleted.count === 0) throw ApiError.notFound("Budget not found");
    await auditTx(tx, { userId, action: "BUDGET_DELETED", entity: "Budget", entityId: id });
  });
}
