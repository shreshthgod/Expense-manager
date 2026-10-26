import type { Category, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { DEFAULT_CATEGORIES } from "@/lib/constants";
import type { TxClient } from "@/server/db/idempotency";
import type { z } from "zod";
import type { categoryCreateSchema, categoryUpdateSchema } from "@/lib/validation/schemas";

export interface CategoryDTO {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  type: "EXPENSE" | "INCOME" | "BOTH";
  isSystem: boolean;
  spendingClass: "ESSENTIAL" | "DISCRETIONARY" | null;
  costBehavior: "FIXED" | "VARIABLE" | null;
  archived: boolean;
  usage?: { transactions: number; budgets: number; recurring: number };
}

export function toCategoryDTO(c: Category): CategoryDTO {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    type: c.type,
    isSystem: c.isSystem,
    spendingClass: c.spendingClass,
    costBehavior: c.costBehavior,
    archived: c.archivedAt != null,
  };
}

/**
 * Creates the user's default categories from the templates. Idempotent: an
 * existing category with the same name (any case) is left untouched, and the
 * insert skips unique conflicts, so concurrent calls cannot duplicate rows.
 */
export async function ensureSystemCategories(userId: string, client: TxClient | typeof prisma = prisma): Promise<number> {
  const existing = await client.category.findMany({ where: { userId }, select: { name: true } });
  const have = new Set(existing.map((c) => c.name.toLowerCase()));
  const missing = DEFAULT_CATEGORIES.filter((t) => !have.has(t.name.toLowerCase()));
  if (missing.length === 0) return 0;
  const result = await client.category.createMany({
    data: missing.map((t) => ({
      userId,
      name: t.name,
      icon: t.icon,
      color: t.color,
      type: t.type,
      isSystem: true,
      spendingClass: t.spendingClass,
      costBehavior: t.costBehavior,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listCategories(
  userId: string,
  opts: { includeArchived?: boolean; type?: "EXPENSE" | "INCOME" | "BOTH"; withUsage?: boolean } = {}
): Promise<CategoryDTO[]> {
  let rows = await prisma.category.findMany({
    where: {
      userId,
      ...(opts.includeArchived ? {} : { archivedAt: null }),
      ...(opts.type ? { type: { in: [opts.type, "BOTH"] } } : {}),
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  if (rows.length === 0 && !opts.type) {
    // Self-heal for users created before categories were per-user.
    await ensureSystemCategories(userId);
    rows = await prisma.category.findMany({
      where: { userId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
  }
  const dtos = rows.map(toCategoryDTO);
  if (!opts.withUsage || dtos.length === 0) return dtos;

  const ids = dtos.map((d) => d.id);
  const [tx, budgets, recurring] = await Promise.all([
    prisma.transaction.groupBy({ by: ["categoryId"], where: { userId, categoryId: { in: ids }, deletedAt: null }, _count: true }),
    prisma.budget.groupBy({ by: ["categoryId"], where: { userId, categoryId: { in: ids } }, _count: true }),
    prisma.recurringTransaction.groupBy({ by: ["categoryId"], where: { userId, categoryId: { in: ids } }, _count: true }),
  ]);
  const count = (rows: { categoryId: string | null; _count: number }[], id: string) =>
    rows.find((r) => r.categoryId === id)?._count ?? 0;
  return dtos.map((d) => ({
    ...d,
    usage: { transactions: count(tx, d.id), budgets: count(budgets, d.id), recurring: count(recurring, d.id) },
  }));
}

async function assertNameAvailable(userId: string, name: string, exceptId?: string) {
  const clash = await prisma.category.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true, archivedAt: true },
  });
  if (clash) {
    throw ApiError.validation([
      {
        path: ["name"],
        message: clash.archivedAt
          ? `An archived category named "${clash.name}" exists. Unarchive it instead.`
          : `You already have a category named "${clash.name}"`,
      },
    ]);
  }
}

export async function createCategory(userId: string, input: z.infer<typeof categoryCreateSchema>): Promise<CategoryDTO> {
  await assertNameAvailable(userId, input.name);
  const row = await prisma.category.create({
    data: {
      userId,
      name: input.name,
      icon: input.icon ?? null,
      color: input.color ?? null,
      type: input.type,
      isSystem: false,
      spendingClass: input.type === "INCOME" ? null : (input.spendingClass ?? null),
      costBehavior: input.type === "INCOME" ? null : (input.costBehavior ?? null),
    },
  });
  return toCategoryDTO(row);
}

async function getOwned(userId: string, id: string) {
  const category = await prisma.category.findFirst({ where: { id, userId } });
  if (!category) throw ApiError.notFound("Category not found");
  return category;
}

export async function updateCategory(userId: string, id: string, input: z.infer<typeof categoryUpdateSchema>): Promise<CategoryDTO> {
  const category = await getOwned(userId, id);
  if (category.isSystem) {
    if (input.name != null && input.name !== category.name) {
      throw ApiError.field("name", "Default categories cannot be renamed. Create a custom category instead.");
    }
    if (input.type != null && input.type !== category.type) {
      throw ApiError.field("type", "The type of a default category cannot be changed.");
    }
  }
  if (input.name != null && input.name.toLowerCase() !== category.name.toLowerCase()) {
    await assertNameAvailable(userId, input.name, id);
  }
  if (input.type != null && input.type !== category.type && input.type !== "BOTH") {
    // Changing EXPENSE ⇄ INCOME would silently re-type existing records.
    const conflicting = await prisma.transaction.count({
      where: { userId, categoryId: id, deletedAt: null, type: input.type === "EXPENSE" ? "INCOME" : "EXPENSE" },
    });
    if (conflicting > 0) {
      throw ApiError.field("type", `${conflicting} transaction(s) use this category as ${input.type === "EXPENSE" ? "income" : "expense"}. Use "Both" instead.`);
    }
  }
  const data: Prisma.CategoryUpdateInput = {};
  if (input.name != null) data.name = input.name;
  if (input.icon !== undefined) data.icon = input.icon;
  if (input.color !== undefined) data.color = input.color;
  if (input.type != null) data.type = input.type;
  if (input.spendingClass !== undefined) data.spendingClass = input.spendingClass;
  if (input.costBehavior !== undefined) data.costBehavior = input.costBehavior;
  if (input.archived !== undefined) data.archivedAt = input.archived ? (category.archivedAt ?? new Date()) : null;
  const row = await prisma.category.update({ where: { id }, data });
  return toCategoryDTO(row);
}

/**
 * Deletion never destroys history: default categories can only be archived;
 * a referenced custom category must be reassigned (all records move to the
 * target in one transaction) or archived instead.
 */
export async function deleteCategory(userId: string, id: string, reassignToCategoryId?: string | null): Promise<{ reassigned: number }> {
  const category = await getOwned(userId, id);
  if (category.isSystem) {
    throw ApiError.rule("Default categories cannot be deleted. Archive it to hide it from new entries.", "SYSTEM_CATEGORY");
  }
  const [transactions, budgets, recurring] = await Promise.all([
    prisma.transaction.count({ where: { userId, categoryId: id } }),
    prisma.budget.count({ where: { userId, categoryId: id } }),
    prisma.recurringTransaction.count({ where: { userId, categoryId: id } }),
  ]);
  const referenced = transactions + budgets + recurring;

  if (referenced > 0 && !reassignToCategoryId) {
    throw ApiError.rule(
      `"${category.name}" is used by ${transactions} transaction(s), ${budgets} budget(s) and ${recurring} recurring rule(s). Choose a category to move them to, or archive it instead.`,
      "CATEGORY_IN_USE",
      [{ path: ["reassignToCategoryId"], message: "Choose where to move existing records" }]
    );
  }

  return prisma.$transaction(async (tx) => {
    if (referenced > 0 && reassignToCategoryId) {
      if (reassignToCategoryId === id) throw ApiError.field("reassignToCategoryId", "Choose a different category");
      const target = await tx.category.findFirst({ where: { id: reassignToCategoryId, userId } });
      if (!target) throw ApiError.field("reassignToCategoryId", "Category not found");
      if (category.type !== "BOTH" && target.type !== "BOTH" && target.type !== category.type) {
        throw ApiError.field("reassignToCategoryId", `Choose another ${category.type === "EXPENSE" ? "expense" : "income"} category`);
      }
      await tx.transaction.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
      await tx.budget.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
      await tx.recurringTransaction.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
    }
    await tx.category.delete({ where: { id } });
    return { reassigned: referenced };
  });
}
