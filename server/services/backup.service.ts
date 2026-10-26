import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { APP_VERSION } from "@/lib/constants";
import type { TxClient } from "@/server/db/idempotency";
import { auditTx } from "@/server/services/audit.service";
import { rebuildBalances, verifyLedger } from "@/server/services/account.service";
import { verifyGoalLedger } from "@/server/services/goal.service";

/**
 * Full-fidelity JSON backup and restore.
 *
 * Format: { format, schemaVersion, appVersion, exportedAt, counts, data: { <table>: row[] } }
 * - Every financial table is included; sessions, notifications, audit logs,
 *   AI conversations and attachment files are not (listed in `excluded`).
 * - Restore validates the file first (dryRun shows exactly what would happen),
 *   gives every record a NEW id and remaps all references, runs in ONE database
 *   transaction (all or nothing), rebuilds account balances from the ledger and
 *   verifies the ledger and goal invariants before committing.
 * - mode "replace" deletes the user's current financial data first;
 *   mode "merge" adds to it (categories and merchants are matched by name).
 */

export const BACKUP_FORMAT = "expense-manager-backup";
export const BACKUP_SCHEMA_VERSION = 5;
const MIN_SUPPORTED_SCHEMA = 5;

type Row = Record<string, unknown>;

/** Tables in dependency order, with the reference fields that must be remapped. */
const TABLES = [
  { key: "categories", model: "category", refs: {} },
  { key: "accounts", model: "account", refs: {} },
  { key: "merchants", model: "merchant", refs: { defaultCategoryId: "categories" } },
  { key: "merchantAliases", model: "merchantAlias", refs: { merchantId: "merchants" } },
  { key: "recurring", model: "recurringTransaction", refs: { accountId: "accounts", destinationAccountId: "accounts", categoryId: "categories" } },
  {
    key: "transactions",
    model: "transaction",
    refs: {
      accountId: "accounts",
      destinationAccountId: "accounts",
      categoryId: "categories",
      merchantId: "merchants",
      recurringTransactionId: "recurring",
      originalTransactionId: "transactions",
    },
  },
  { key: "splits", model: "transactionSplit", refs: { transactionId: "transactions", categoryId: "categories" } },
  { key: "occurrences", model: "recurringOccurrence", refs: { recurringId: "recurring", transactionId: "transactions" } },
  { key: "budgets", model: "budget", refs: { categoryId: "categories" } },
  { key: "goals", model: "savingsGoal", refs: { accountId: "accounts" } },
  { key: "goalContributions", model: "goalContribution", refs: { goalId: "goals", transactionId: "transactions" } },
  { key: "rules", model: "automationRule", refs: { setCategoryId: "categories", matchAccountId: "accounts" } },
  { key: "templates", model: "transactionTemplate", refs: { accountId: "accounts", destinationAccountId: "accounts", categoryId: "categories" } },
  { key: "budgetTemplates", model: "budgetTemplate", refs: {} },
] as const;

type TableKey = (typeof TABLES)[number]["key"];

/** Fields never restored from a file (derived, per-installation or security-relevant). */
const DROP_FIELDS = new Set(["userId", "createdAt", "updatedAt", "version", "reconciledAt", "reconciliationId", "importJobId", "importRowIndex", "lastReconciledAt", "appliedCount", "lastAppliedAt"]);

function delegate(tx: TxClient | typeof prisma, model: string) {
  return (tx as unknown as Record<string, { findMany: (a: unknown) => Promise<Row[]>; createMany: (a: unknown) => Promise<{ count: number }> }>)[model];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportBackup(userId: string) {
  const data: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const rows = await delegate(prisma, t.model).findMany({ where: { userId } });
    data[t.key] = rows.map((r) => {
      const out: Row = {};
      for (const [k, v] of Object.entries(r)) {
        if (k === "userId") continue;
        out[k] = v instanceof Prisma.Decimal ? v.toString() : v instanceof Date ? v.toISOString() : v;
      }
      return out;
    });
  }
  const [profile, preferences] = await Promise.all([
    prisma.profile.findUnique({ where: { userId }, select: { monthlyIncome: true, occupation: true, timezone: true } }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ]);
  const { id: _pid, userId: _puid, ...prefs } = preferences ?? ({} as Row);
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]));
  const backup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    excluded: ["login and sessions", "notifications", "security activity", "AI conversations", "attachment files", "import history", "reconciliation history"],
    settings: {
      profile: profile ? { monthlyIncome: profile.monthlyIncome?.toString() ?? null, occupation: profile.occupation, timezone: profile.timezone } : null,
      preferences: prefs,
    },
    data,
  };
  await prisma.auditLog.create({ data: { userId, action: "BACKUP_EXPORTED", entity: "User", entityId: userId, metadata: counts } });
  return backup;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const rowSchema = z.record(z.unknown()).refine((r) => typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64, "Every record needs an id");

export const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT, { errorMap: () => ({ message: "This isn't an Expense Manager backup file" }) }),
  schemaVersion: z.number().int(),
  appVersion: z.string().optional(),
  exportedAt: z.string().optional(),
  settings: z
    .object({ profile: z.record(z.unknown()).nullable().optional(), preferences: z.record(z.unknown()).optional() })
    .optional(),
  data: z.object(Object.fromEntries(TABLES.map((t) => [t.key, z.array(rowSchema).max(200_000).default([])])) as Record<TableKey, z.ZodDefault<z.ZodArray<typeof rowSchema>>>),
});

export type BackupFile = z.infer<typeof backupFileSchema>;

export interface RestorePlan {
  mode: "merge" | "replace";
  schemaVersion: number;
  appVersion: string | null;
  exportedAt: string | null;
  counts: Record<string, number>;
  problems: string[];
  warnings: string[];
  matchedCategories: number;
  matchedMerchants: number;
  willDelete: Record<string, number> | null;
}

/** Structural checks: every reference must point at a record in the file. */
function checkReferences(file: BackupFile): string[] {
  const problems: string[] = [];
  const ids = new Map<string, Set<string>>();
  for (const t of TABLES) ids.set(t.key, new Set(file.data[t.key].map((r) => String(r.id))));
  for (const t of TABLES) {
    for (const [field, target] of Object.entries(t.refs)) {
      const known = ids.get(target)!;
      const missing = file.data[t.key].filter((r) => r[field] != null && !known.has(String(r[field]))).length;
      if (missing) problems.push(`${missing} ${t.key} record(s) refer to a missing ${target.replace(/s$/, "")} (${field}).`);
    }
  }
  const dup = TABLES.flatMap((t) => (ids.get(t.key)!.size !== file.data[t.key].length ? [`Duplicate ids in ${t.key}.`] : []));
  const txs = file.data.transactions;
  const badAmount = txs.filter((r) => !(Number(r.amount) > 0)).length;
  if (badAmount) problems.push(`${badAmount} transaction(s) have an invalid amount.`);
  return [...problems, ...dup];
}

export function parseBackup(raw: unknown): BackupFile {
  const parsed = backupFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.validation(parsed.error.issues.slice(0, 5).map((i) => ({ path: ["file", ...i.path.map(String)], message: i.message })));
  }
  if (parsed.data.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw ApiError.field("file", "This backup was made by a newer version of the app. Update the app first.");
  }
  if (parsed.data.schemaVersion < MIN_SUPPORTED_SCHEMA) {
    throw ApiError.field("file", `Backups older than schema ${MIN_SUPPORTED_SCHEMA} can't be restored. Export a new backup from an up-to-date app.`);
  }
  return parsed.data;
}

async function currentCounts(userId: string) {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t.key] = (await delegate(prisma, t.model).findMany({ where: { userId }, select: { id: true } } as never)).length;
  return out;
}

export async function planRestore(userId: string, file: BackupFile, mode: "merge" | "replace"): Promise<RestorePlan> {
  const problems = checkReferences(file);
  const warnings: string[] = [];
  let matchedCategories = 0;
  let matchedMerchants = 0;
  if (mode === "merge") {
    const [cats, merchants] = await Promise.all([
      prisma.category.findMany({ where: { userId }, select: { name: true } }),
      prisma.merchant.findMany({ where: { userId }, select: { name: true } }),
    ]);
    const catNames = new Set(cats.map((c) => c.name.toLowerCase()));
    const merchantNames = new Set(merchants.map((m) => m.name.toLowerCase()));
    matchedCategories = file.data.categories.filter((c) => catNames.has(String(c.name).toLowerCase())).length;
    matchedMerchants = file.data.merchants.filter((m) => merchantNames.has(String(m.name).toLowerCase())).length;
    if (file.data.transactions.length) warnings.push("Merging adds every transaction in the file. If this backup overlaps data you already have, you may get duplicates — use Replace instead.");
    if (file.data.budgets.length) warnings.push("Budgets that clash with an existing budget for the same category and period are skipped.");
  } else {
    warnings.push("Replace permanently deletes your current accounts, transactions, budgets, goals, bills and rules before restoring.");
  }
  if (file.data.transactions.some((t) => t.reconciledAt)) warnings.push("Reconciliation marks are not restored; reconcile again if needed.");
  return {
    mode,
    schemaVersion: file.schemaVersion,
    appVersion: file.appVersion ?? null,
    exportedAt: file.exportedAt ?? null,
    counts: Object.fromEntries(TABLES.map((t) => [t.key, file.data[t.key].length])),
    problems,
    warnings,
    matchedCategories,
    matchedMerchants,
    willDelete: mode === "replace" ? await currentCounts(userId) : null,
  };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

async function deleteFinancialData(tx: TxClient, userId: string) {
  await tx.recurringOccurrence.deleteMany({ where: { userId } });
  await tx.goalContribution.deleteMany({ where: { userId } });
  await tx.transactionSplit.deleteMany({ where: { userId } });
  await tx.attachment.deleteMany({ where: { userId } });
  await tx.transaction.deleteMany({ where: { userId, originalTransactionId: { not: null } } });
  await tx.transaction.deleteMany({ where: { userId } });
  await tx.reconciliation.deleteMany({ where: { userId } });
  await tx.importJob.deleteMany({ where: { userId } });
  await tx.recurringTransaction.deleteMany({ where: { userId } });
  await tx.budget.deleteMany({ where: { userId } });
  await tx.savingsGoal.deleteMany({ where: { userId } });
  await tx.automationRule.deleteMany({ where: { userId } });
  await tx.transactionTemplate.deleteMany({ where: { userId } });
  await tx.budgetTemplate.deleteMany({ where: { userId } });
  await tx.merchantAlias.deleteMany({ where: { userId } });
  await tx.merchant.deleteMany({ where: { userId } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.userPreference.updateMany({ where: { userId }, data: { defaultAccountId: null } });
  await tx.category.deleteMany({ where: { userId } });
}

const CHUNK = 1000;

export async function restoreBackup(userId: string, file: BackupFile, mode: "merge" | "replace") {
  const plan = await planRestore(userId, file, mode);
  if (plan.problems.length) {
    throw ApiError.validation(plan.problems.slice(0, 5).map((m) => ({ path: ["file"], message: m })));
  }
  const inserted: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      if (mode === "replace") await deleteFinancialData(tx, userId);
      const idMap = new Map<TableKey, Map<string, string>>(TABLES.map((t) => [t.key, new Map()]));

      // Merge: reuse existing categories / merchants with the same name.
      if (mode === "merge") {
        const cats = await tx.category.findMany({ where: { userId }, select: { id: true, name: true } });
        const byName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
        for (const c of file.data.categories) {
          const hit = byName.get(String(c.name).toLowerCase());
          if (hit) idMap.get("categories")!.set(String(c.id), hit);
        }
      }
      const existingBudgets = mode === "merge" ? await tx.budget.findMany({ where: { userId }, select: { categoryId: true, period: true } }) : [];
      const existingTemplateNames = new Set((await tx.transactionTemplate.findMany({ where: { userId }, select: { name: true } })).map((t) => t.name));
      const existingBudgetTemplateNames = new Set((await tx.budgetTemplate.findMany({ where: { userId }, select: { name: true } })).map((t) => t.name));

      for (const t of TABLES) {
        const map = idMap.get(t.key)!;
        const rows = file.data[t.key];
        // Assign new ids first (self references such as refunds need them).
        for (const r of rows) if (!map.has(String(r.id))) map.set(String(r.id), randomUUID());

        const prepared: Row[] = [];
        for (const r of rows) {
          // Already matched to an existing record (merge) → nothing to insert.
          if (t.key === "categories" && mode === "merge") {
            const target = map.get(String(r.id))!;
            if (await tx.category.findFirst({ where: { id: target, userId }, select: { id: true } })) {
              skipped[t.key] = (skipped[t.key] ?? 0) + 1;
              continue;
            }
          }
          const out: Row = {};
          for (const [k, v] of Object.entries(r)) if (!DROP_FIELDS.has(k)) out[k] = v;
          out.id = map.get(String(r.id));
          out.userId = userId;
          for (const [field, target] of Object.entries(t.refs)) {
            if (out[field] != null) out[field] = idMap.get(target as TableKey)!.get(String(out[field])) ?? null;
          }
          if (t.key === "budgetTemplates" && Array.isArray(out.items)) {
            out.items = (out.items as Row[]).map((i) => ({ ...i, categoryId: i.categoryId ? idMap.get("categories")!.get(String(i.categoryId)) ?? null : null }));
          }
          if (t.key === "budgets" && mode === "merge") {
            if (existingBudgets.some((b) => b.categoryId === (out.categoryId ?? null) && b.period === out.period)) {
              skipped[t.key] = (skipped[t.key] ?? 0) + 1;
              continue;
            }
          }
          if (t.key === "templates" && existingTemplateNames.has(String(out.name))) out.name = `${out.name} (restored)`;
          if (t.key === "budgetTemplates" && existingBudgetTemplateNames.has(String(out.name))) out.name = `${out.name} (restored)`;
          if (t.key === "merchants" && mode === "merge") {
            const hit = await tx.merchant.findFirst({ where: { userId, name: { equals: String(out.name), mode: "insensitive" } }, select: { id: true } });
            if (hit) {
              map.set(String(r.id), hit.id);
              skipped[t.key] = (skipped[t.key] ?? 0) + 1;
              continue;
            }
          }
          if (t.key === "merchantAliases" && mode === "merge") {
            const hit = await tx.merchantAlias.findFirst({ where: { userId, pattern: String(out.pattern) }, select: { id: true } });
            if (hit) {
              skipped[t.key] = (skipped[t.key] ?? 0) + 1;
              continue;
            }
          }
          if (t.key === "accounts") out.balance = out.openingBalance ?? "0";
          if (t.key === "goals") out.currentAmount = "0";
          if (t.key === "categories") out.isSystem = false;
          prepared.push(out);
        }
        // Refunds reference their original transaction: insert originals first.
        const ordered =
          t.key === "transactions" ? [...prepared.filter((r) => !r.originalTransactionId), ...prepared.filter((r) => r.originalTransactionId)] : prepared;
        for (let i = 0; i < ordered.length; i += CHUNK) {
          await delegate(tx, t.model).createMany({ data: ordered.slice(i, i + CHUNK) });
        }
        inserted[t.key] = ordered.length;
      }

      // Derived state: balances from the ledger, goal totals from contributions.
      await rebuildBalances(tx, userId);
      await tx.$executeRaw`
        UPDATE "SavingsGoal" g SET "currentAmount" = COALESCE((SELECT SUM(c."amount") FROM "GoalContribution" c WHERE c."goalId" = g."id"), 0)
        WHERE g."userId" = ${userId}`;

      if (file.settings?.preferences && mode === "replace") {
        const p = file.settings.preferences;
        const pick = <T>(k: string, ok: (v: unknown) => boolean): T | undefined => (ok(p[k]) ? (p[k] as T) : undefined);
        await tx.userPreference.updateMany({
          where: { userId },
          data: {
            currency: pick<string>("currency", (v) => typeof v === "string" && v.length === 3),
            weekStartsOn: pick<number>("weekStartsOn", (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6),
            monthStartDay: pick<number>("monthStartDay", (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 28),
            emergencyFundMonths: pick<number>("emergencyFundMonths", (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 24),
            defaultAccountId: typeof p.defaultAccountId === "string" ? idMap.get("accounts")!.get(p.defaultAccountId) ?? null : null,
          },
        });
      }
      await auditTx(tx, { userId, action: "BACKUP_RESTORED", entity: "User", entityId: userId, metadata: { mode, inserted } });
    },
    { timeout: 180_000, maxWait: 10_000 }
  );

  const [ledger, goals] = await Promise.all([verifyLedger(userId), verifyGoalLedger(userId)]);
  return { plan, inserted, skipped, ledgerOk: ledger.length === 0 && goals.length === 0 };
}
