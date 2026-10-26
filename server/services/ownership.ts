import type { Account, Category } from "@prisma/client";
import { ApiError } from "@/lib/api/errors";
import type { TxClient } from "@/server/db/idempotency";

/**
 * Foreign-reference guards. A syntactically valid cuid is NOT proof of
 * ownership: every id accepted from a client is resolved with a userId-scoped
 * query before it is written. Unknown and foreign ids produce the same field
 * error, so ids of other users cannot be probed.
 */

export async function requireOwnedAccounts(
  tx: TxClient,
  userId: string,
  refs: { path: string; id: string | null | undefined; allowArchived?: boolean }[]
): Promise<Map<string, Account>> {
  const ids = [...new Set(refs.map((r) => r.id).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await tx.account.findMany({ where: { userId, id: { in: ids } } });
  const byId = new Map(rows.map((a) => [a.id, a]));
  const issues: { path: string[]; message: string }[] = [];
  for (const ref of refs) {
    if (!ref.id) continue;
    const account = byId.get(ref.id);
    if (!account) issues.push({ path: [ref.path], message: "Account not found" });
    else if (account.archivedAt && !ref.allowArchived) {
      issues.push({ path: [ref.path], message: `"${account.name}" is archived. Unarchive it to record new activity.` });
    }
  }
  if (issues.length) throw ApiError.validation(issues);
  return byId;
}

export type CategoryUse = "EXPENSE" | "INCOME" | "ANY";

export async function requireOwnedCategory(
  tx: TxClient,
  userId: string,
  id: string | null | undefined,
  use: CategoryUse,
  opts: { path?: string; allowArchived?: boolean } = {}
): Promise<Category | null> {
  if (!id) return null;
  const path = opts.path ?? "categoryId";
  const category = await tx.category.findFirst({ where: { id, userId } });
  if (!category) throw ApiError.field(path, "Category not found");
  if (category.archivedAt && !opts.allowArchived) {
    throw ApiError.field(path, `"${category.name}" is archived. Choose another category or unarchive it.`);
  }
  if (use !== "ANY" && category.type !== "BOTH" && category.type !== use) {
    throw ApiError.field(path, use === "EXPENSE" ? "Choose an expense category" : "Choose an income category");
  }
  return category;
}
