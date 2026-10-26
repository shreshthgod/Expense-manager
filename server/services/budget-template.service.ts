import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { fromDbDate, fromDbDateOrNull, type ISODate } from "@/lib/dates/date-only";
import type { budgetTemplateSchema } from "@/lib/validation/schemas";
import { runInTransaction } from "@/server/db/idempotency";
import { auditTx } from "@/server/services/audit.service";
import { createBudget } from "@/server/services/budget.service";

type TemplateInput = z.infer<typeof budgetTemplateSchema>;
export type TemplateItem = TemplateInput["items"][number];

export interface BudgetTemplateDTO {
  id: string;
  name: string;
  items: (TemplateItem & { categoryName: string | null; categoryMissing: boolean })[];
  total: number;
  createdAt: string;
}

async function hydrate(userId: string, rows: { id: string; name: string; items: Prisma.JsonValue; createdAt: Date }[]): Promise<BudgetTemplateDTO[]> {
  const cats = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true, archivedAt: true } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  return rows.map((r) => {
    const items = (Array.isArray(r.items) ? r.items : []) as unknown as TemplateItem[];
    return {
      id: r.id,
      name: r.name,
      items: items.map((i) => {
        const cat = i.categoryId ? byId.get(i.categoryId) : null;
        return { ...i, categoryId: i.categoryId ?? null, categoryName: cat?.name ?? null, categoryMissing: !!i.categoryId && (!cat || !!cat.archivedAt) };
      }),
      total: items.filter((i) => (i.period ?? "MONTHLY") === "MONTHLY").reduce((s, i) => s + Number(i.amount), 0),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function listBudgetTemplates(userId: string) {
  const rows = await prisma.budgetTemplate.findMany({ where: { userId }, orderBy: { name: "asc" } });
  return hydrate(userId, rows);
}

async function assertCategories(userId: string, items: TemplateItem[]) {
  const ids = [...new Set(items.map((i) => i.categoryId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const found = await prisma.category.count({ where: { userId, id: { in: ids }, type: "EXPENSE" } });
  if (found !== ids.length) throw ApiError.field("items", "One of the categories doesn't exist or isn't an expense category");
}

export async function createBudgetTemplate(userId: string, input: TemplateInput) {
  await assertCategories(userId, input.items);
  const row = await prisma.budgetTemplate.create({
    data: { userId, name: input.name, items: input.items as unknown as Prisma.InputJsonValue },
  });
  return (await hydrate(userId, [row]))[0];
}

/** Captures the user's current repeating budgets as a reusable template. */
export async function templateFromCurrentBudgets(userId: string, name: string) {
  const budgets = await prisma.budget.findMany({ where: { userId, period: { not: "CUSTOM" }, endDate: null }, orderBy: { createdAt: "asc" } });
  if (!budgets.length) throw ApiError.rule("There are no repeating budgets to save as a template.", "NO_BUDGETS");
  return createBudgetTemplate(userId, {
    name,
    items: budgets.map((b) => ({
      name: b.name,
      categoryId: b.categoryId,
      amount: Number(b.amount),
      period: b.period as "WEEKLY" | "MONTHLY" | "YEARLY",
      rolloverMode: b.rolloverMode,
    })),
  });
}

export async function deleteBudgetTemplate(userId: string, id: string) {
  const r = await prisma.budgetTemplate.deleteMany({ where: { id, userId } });
  if (!r.count) throw ApiError.notFound("Template not found");
}

export interface ApplyPlanItem {
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: number;
  period: string;
  action: "create" | "replace" | "skip";
  reason: string | null;
  conflictBudgetId: string | null;
}

/**
 * Applies a template from `startDate`. For every item whose scope (category,
 * period) already has an open-ended budget, the existing budget is either left
 * alone (default) or — with explicit consent — ended the day before and a new
 * one is created, so earlier cycles keep their history. dryRun returns the plan
 * without writing anything.
 */
export async function applyBudgetTemplate(
  userId: string,
  id: string,
  input: { startDate: ISODate; replaceConflicts: boolean; dryRun: boolean }
): Promise<{ plan: ApplyPlanItem[]; created: number; replaced: number; skipped: number; applied: boolean }> {
  const [template] = await hydrate(userId, await prisma.budgetTemplate.findMany({ where: { id, userId } }));
  if (!template) throw ApiError.notFound("Template not found");
  const existing = await prisma.budget.findMany({ where: { userId } });
  const plan: ApplyPlanItem[] = template.items.map((item) => {
    const base = { name: item.name, categoryId: item.categoryId ?? null, categoryName: item.categoryName, amount: Number(item.amount), period: item.period };
    if (item.categoryMissing) return { ...base, action: "skip", reason: "The category no longer exists", conflictBudgetId: null };
    const clash = existing.find((b) => {
      if (b.categoryId !== (item.categoryId ?? null) || b.period !== item.period) return false;
      const end = fromDbDateOrNull(b.endDate) ?? "9999-12-31";
      return end >= input.startDate;
    });
    if (!clash) return { ...base, action: "create", reason: null, conflictBudgetId: null };
    if (fromDbDate(clash.startDate) >= input.startDate) {
      return { ...base, action: "skip", reason: `"${clash.name}" starts on or after this date`, conflictBudgetId: clash.id };
    }
    return input.replaceConflicts
      ? { ...base, action: "replace", reason: `Ends "${clash.name}" the day before`, conflictBudgetId: clash.id }
      : { ...base, action: "skip", reason: `"${clash.name}" already covers this`, conflictBudgetId: clash.id };
  });
  const count = (a: ApplyPlanItem["action"]) => plan.filter((p) => p.action === a).length;
  if (input.dryRun) return { plan, created: count("create"), replaced: count("replace"), skipped: count("skip"), applied: false };

  await runInTransaction(userId, undefined, async (tx) => {
    for (const [i, p] of plan.entries()) {
      if (p.action === "skip") continue;
      if (p.action === "replace" && p.conflictBudgetId) {
        const dayBefore = new Date(`${input.startDate}T00:00:00Z`);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await tx.budget.update({ where: { id: p.conflictBudgetId }, data: { endDate: dayBefore, version: { increment: 1 } } });
      }
      const item = template.items[i];
      await createBudget(
        userId,
        {
          name: item.name,
          amount: Number(item.amount),
          period: item.period,
          startDate: input.startDate,
          endDate: null,
          categoryId: item.categoryId ?? null,
          rolloverMode: item.rolloverMode ?? "NONE",
        },
        { client: tx }
      );
    }
    await auditTx(tx, { userId, action: "BUDGET_CREATED", entity: "BudgetTemplate", entityId: id, metadata: { created: count("create"), replaced: count("replace") } });
  });
  return { plan, created: count("create"), replaced: count("replace"), skipped: count("skip"), applied: true };
}
