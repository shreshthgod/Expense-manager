import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, fromDbDate, toDbDate, type ISODate } from "@/lib/dates/date-only";
import { normalizeRow, type NormalizedRow } from "@/lib/import/normalize";
import type { ImportMappingConfig } from "@/lib/validation/schemas";
import { applyEffects, ledgerEffects } from "@/server/ledger/effects";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { loadAliasIndex, matchMerchant, normalizeMerchantText } from "@/server/services/merchant.service";
import { activeRules, firstMatch, renderTemplate } from "@/server/services/rules.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Statement import.
 *   preview  → parse + validate every row, match categories, run rules, score
 *              duplicates; stored as an ImportJob (nothing touches the ledger)
 *   confirm  → the user's per-row decisions are committed in chunks; each row
 *              carries UNIQUE(importJobId, importRowIndex), so a retried or
 *              concurrent confirm resumes instead of inserting twice
 *   undo     → soft-deletes the job's transactions (balances reverse)
 * Imported statements are NOT a live bank connection and are labelled so.
 */

export type DuplicateLevel = "likely" | "possible" | "unique";

export interface PreviewRow extends NormalizedRow {
  type: "EXPENSE" | "INCOME" | null;
  categoryId: string | null;
  categorySource: "file" | "rule" | "history" | null;
  tags: string[];
  duplicate: { level: DuplicateLevel; score: number; matchId: string | null; reason: string | null };
  warnings: string[];
  defaultAction: "import" | "skip";
}

export interface ImportJobDTO {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  status: "PREVIEWED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  duplicateCount: number;
  createdAt: string;
  completedAt: string | null;
  rows?: PreviewRow[];
  summary?: { rejected: { rowIndex: number; reason: string }[] } | null;
}

function tokens(s: string | null | undefined): Set<string> {
  return new Set(normalizeMerchantText(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

/** Duplicate score 0-100 from amount, date distance and text similarity. */
export function duplicateScore(
  row: { date: ISODate; amount: number; text: string | null },
  existing: { date: ISODate; amount: number; text: string | null }
): number {
  if (Math.round(row.amount * 100) !== Math.round(existing.amount * 100)) return 0;
  let score = 50;
  const days = Math.abs((Date.parse(row.date) - Date.parse(existing.date)) / 86_400_000);
  score += days === 0 ? 25 : days <= 1 ? 15 : days <= 3 ? 5 : 0;
  const a = tokens(row.text);
  const b = tokens(existing.text);
  if (a.size && b.size) {
    const inter = [...a].filter((t) => b.has(t)).length;
    const jaccard = inter / new Set([...a, ...b]).size;
    score += jaccard >= 0.5 ? 25 : inter > 0 ? 10 : 0;
  }
  return Math.min(100, score);
}

export function levelFor(score: number): DuplicateLevel {
  return score >= 80 ? "likely" : score >= 55 ? "possible" : "unique";
}

function toJobDTO(job: Prisma.ImportJobGetPayload<object>, accountName: string, withRows: boolean): ImportJobDTO {
  return {
    id: job.id,
    accountId: job.accountId,
    accountName,
    fileName: job.fileName,
    status: job.status,
    totalRows: job.totalRows,
    importedCount: job.importedCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    duplicateCount: job.duplicateCount,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    ...(withRows ? { rows: job.rows as unknown as PreviewRow[] } : {}),
    summary: (job.summary as ImportJobDTO["summary"]) ?? null,
  };
}

export async function previewImport(
  userId: string,
  input: { accountId: string; fileName: string; fileHash: string; mapping: ImportMappingConfig; headers: string[]; rows: string[][] }
): Promise<ImportJobDTO> {
  const account = await prisma.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw ApiError.field("accountId", "Account not found");
  if (account.archivedAt) throw ApiError.field("accountId", "Unarchive this account before importing into it");
  if (!input.mapping.date || !input.headers.includes(input.mapping.date)) throw ApiError.field("mapping.date", "Map the date column");

  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const normalized = input.rows.map((r, i) => normalizeRow(r, input.headers, input.mapping, i));

  const valid = normalized.filter((r) => r.date && r.amount != null);
  const minDate = valid.reduce<string | null>((m, r) => (!m || r.date! < m ? r.date! : m), null);
  const maxDate = valid.reduce<string | null>((m, r) => (!m || r.date! > m ? r.date! : m), null);
  const [categories, rules, existing] = await Promise.all([
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, archivedAt: true } }),
    activeRules(prisma, userId),
    minDate && maxDate
      ? prisma.transaction.findMany({
          where: {
            userId,
            deletedAt: null,
            OR: [{ accountId: input.accountId }, { destinationAccountId: input.accountId }],
            transactionDate: { gte: toDbDate(addDays(minDate, -3)), lte: toDbDate(addDays(maxDate, 3)) },
          },
          select: { id: true, transactionDate: true, amount: true, merchant: true, description: true },
        })
      : [],
  ]);
  const categoryByName = new Map(categories.filter((c) => !c.archivedAt).map((c) => [c.name.toLowerCase(), c]));

  // Merchant history for category suggestions (one query for the whole file).
  const merchantKeys = [...new Set(valid.map((r) => normalizeMerchantText(r.merchant)).filter(Boolean))];
  const history = merchantKeys.length
    ? await prisma.$queryRaw<{ m: string; categoryId: string; n: bigint }[]>`
        SELECT DISTINCT ON (LOWER(TRIM(t."merchant"))) LOWER(TRIM(t."merchant")) AS m, t."categoryId", COUNT(*) AS n
        FROM "Transaction" t
        WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."categoryId" IS NOT NULL
          AND LOWER(TRIM(t."merchant")) IN (${Prisma.join(merchantKeys)})
        GROUP BY LOWER(TRIM(t."merchant")), t."categoryId"
        ORDER BY LOWER(TRIM(t."merchant")), COUNT(*) DESC`
    : [];
  const historyByMerchant = new Map(history.map((h) => [h.m, h.categoryId]));

  const seen: { date: ISODate; amount: number; text: string | null; rowIndex: number }[] = [];
  let duplicateCount = 0;
  const rows: PreviewRow[] = normalized.map((r) => {
    const warnings: string[] = [];
    const type = r.direction === "out" ? "EXPENSE" : r.direction === "in" ? "INCOME" : null;
    let categoryId: string | null = null;
    let categorySource: PreviewRow["categorySource"] = null;
    let tags: string[] = [];
    let description = r.description;
    if (r.categoryName) {
      const match = categoryByName.get(r.categoryName.toLowerCase());
      if (match && (match.type === "BOTH" || match.type === type)) {
        categoryId = match.id;
        categorySource = "file";
      } else warnings.push(`Category "${r.categoryName}" not found — it will be left for review`);
    }
    const rule = firstMatch(rules, { merchant: r.merchant, description: r.description, amount: r.amount, accountId: input.accountId, type });
    if (rule && rule.mode === "AUTO") {
      if (!categoryId && rule.setCategoryId) {
        categoryId = rule.setCategoryId;
        categorySource = "rule";
      }
      tags = rule.addTags;
      if (!description && rule.descriptionTemplate) description = renderTemplate(rule.descriptionTemplate, { merchant: r.merchant, amount: r.amount });
    } else if (rule && !categoryId && rule.setCategoryId) {
      categoryId = rule.setCategoryId;
      categorySource = "rule";
      warnings.push(`Suggested by rule "${rule.name}"`);
    }
    if (!categoryId) {
      const hist = historyByMerchant.get(normalizeMerchantText(r.merchant));
      if (hist) {
        categoryId = hist;
        categorySource = "history";
      }
    }
    if (r.date && r.date > today) warnings.push("Dated in the future — it will be saved as planned");

    let duplicate: PreviewRow["duplicate"] = { level: "unique", score: 0, matchId: null, reason: null };
    if (r.date && r.amount != null) {
      const text = r.merchant ?? r.description;
      let best = { score: 0, id: null as string | null, reason: null as string | null };
      for (const e of existing) {
        const s = duplicateScore({ date: r.date, amount: r.amount, text }, { date: fromDbDate(e.transactionDate), amount: Number(e.amount), text: e.merchant ?? e.description });
        if (s > best.score) best = { score: s, id: e.id, reason: `Matches an existing transaction on ${fromDbDate(e.transactionDate)} for the same amount` };
      }
      for (const prev of seen) {
        const s = duplicateScore({ date: r.date, amount: r.amount, text }, prev);
        if (s > best.score) best = { score: s, id: null, reason: `Same as row ${prev.rowIndex + 1} in this file` };
      }
      duplicate = { level: levelFor(best.score), score: best.score, matchId: best.id, reason: best.score >= 55 ? best.reason : null };
      if (duplicate.level !== "unique") duplicateCount += 1;
      seen.push({ date: r.date, amount: r.amount, text, rowIndex: r.rowIndex });
    }
    return {
      ...r,
      description,
      type,
      categoryId,
      categorySource,
      tags,
      duplicate,
      warnings,
      defaultAction: r.errors.length || duplicate.level === "likely" ? "skip" : "import",
    };
  });

  const job = await prisma.importJob.create({
    data: {
      userId,
      accountId: input.accountId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      rows: rows as unknown as Prisma.InputJsonValue,
      mapping: input.mapping as unknown as Prisma.InputJsonValue,
      totalRows: rows.length,
      duplicateCount,
    },
  });
  return toJobDTO(job, account.name, true);
}

export async function getImportJob(userId: string, id: string, withRows = true): Promise<ImportJobDTO> {
  const job = await prisma.importJob.findFirst({ where: { id, userId } });
  if (!job) throw ApiError.notFound("Import not found");
  const account = await prisma.account.findFirst({ where: { id: job.accountId, userId }, select: { name: true } });
  return toJobDTO(job, account?.name ?? "Deleted account", withRows);
}

export async function listImportJobs(userId: string): Promise<ImportJobDTO[]> {
  const jobs = await prisma.importJob.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
  const accounts = await prisma.account.findMany({ where: { userId, id: { in: [...new Set(jobs.map((j) => j.accountId))] } }, select: { id: true, name: true } });
  const names = new Map(accounts.map((a) => [a.id, a.name]));
  return jobs.map((j) => toJobDTO(j, names.get(j.accountId) ?? "Deleted account", false));
}

const CHUNK = 200;

export async function confirmImport(
  userId: string,
  jobId: string,
  decisions: { rowIndex: number; action: "import" | "skip"; categoryId?: string | null; transferAccountId?: string | null }[]
): Promise<ImportJobDTO> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);

  // Claim the job (serialises concurrent confirms; completed jobs just replay).
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ImportJob" WHERE "id" = ${jobId} AND "userId" = ${userId} FOR UPDATE`;
    const job = await tx.importJob.findFirst({ where: { id: jobId, userId } });
    if (!job) throw ApiError.notFound("Import not found");
    if (job.status === "COMPLETED" || job.status === "PARTIAL") return null;
    await tx.importJob.update({ where: { id: jobId }, data: { status: "PROCESSING" } });
    return job;
  });
  if (!claimed) return getImportJob(userId, jobId, false);

  const account = await prisma.account.findFirst({ where: { id: claimed.accountId, userId } });
  if (!account || account.archivedAt) {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "FAILED", summary: { rejected: [{ rowIndex: -1, reason: "Account missing or archived" }] } } });
    throw ApiError.rule("The account for this import no longer exists or is archived.", "IMPORT_ACCOUNT_UNAVAILABLE");
  }

  const rows = claimed.rows as unknown as PreviewRow[];
  const byIndex = new Map(decisions.map((d) => [d.rowIndex, d]));
  const [categories, accounts, aliasIndex, alreadyImported] = await Promise.all([
    prisma.category.findMany({ where: { userId }, select: { id: true, type: true } }),
    prisma.account.findMany({ where: { userId, archivedAt: null }, select: { id: true } }),
    loadAliasIndex(prisma, userId),
    prisma.transaction.findMany({ where: { importJobId: jobId }, select: { importRowIndex: true } }),
  ]);
  const categoryType = new Map(categories.map((c) => [c.id, c.type]));
  const ownAccounts = new Set(accounts.map((a) => a.id));
  const done = new Set(alreadyImported.map((r) => r.importRowIndex));

  const rejected: { rowIndex: number; reason: string }[] = [];
  const toCreate: Prisma.TransactionCreateManyInput[] = [];
  let skipped = 0;
  for (const r of rows) {
    const d = byIndex.get(r.rowIndex);
    const action = d?.action ?? r.defaultAction;
    if (action === "skip") {
      skipped += 1;
      continue;
    }
    if (done.has(r.rowIndex)) continue;
    if (r.errors.length || !r.date || r.amount == null || !r.direction) {
      rejected.push({ rowIndex: r.rowIndex, reason: r.errors[0] ?? "Invalid row" });
      continue;
    }
    const transferTo = d?.transferAccountId ?? null;
    if (transferTo && (!ownAccounts.has(transferTo) || transferTo === claimed.accountId)) {
      rejected.push({ rowIndex: r.rowIndex, reason: "Transfer account not found" });
      continue;
    }
    const type = transferTo ? "TRANSFER" : r.direction === "out" ? "EXPENSE" : "INCOME";
    let categoryId = transferTo ? null : d?.categoryId !== undefined ? d.categoryId : r.categoryId;
    if (categoryId) {
      const ct = categoryType.get(categoryId);
      if (!ct || (ct !== "BOTH" && ct !== type)) {
        rejected.push({ rowIndex: r.rowIndex, reason: "Category not valid for this row" });
        continue;
      }
    }
    categoryId = categoryId ?? null;
    toCreate.push({
      userId,
      type,
      status: r.date > today ? "PLANNED" : "POSTED",
      amount: new Prisma.Decimal(r.amount.toFixed(2)),
      transactionDate: toDbDate(r.date),
      accountId: type === "TRANSFER" && r.direction === "in" ? transferTo : claimed.accountId,
      destinationAccountId: type === "TRANSFER" ? (r.direction === "in" ? claimed.accountId : transferTo) : null,
      categoryId,
      merchant: r.merchant,
      merchantId: matchMerchant(aliasIndex, r.merchant),
      description: r.description,
      notes: r.reference ? `Ref: ${r.reference}` : null,
      tags: r.tags,
      importJobId: jobId,
      importRowIndex: r.rowIndex,
    });
  }

  const eventIds: string[] = [];
  let imported = alreadyImported.length;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const chunk = toCreate.slice(i, i + CHUNK);
    try {
      await prisma.$transaction(
        async (tx) => {
          const res = await tx.transaction.createMany({ data: chunk, skipDuplicates: true });
          if (res.count !== chunk.length) {
            // Another confirm inserted some rows first: apply effects only for ours.
            throw new Error("CONCURRENT_IMPORT");
          }
          const createdRows = await tx.transaction.findMany({
            where: { importJobId: jobId, importRowIndex: { in: chunk.map((c) => c.importRowIndex!) } },
          });
          const merged = new Map<string, number>();
          for (const row of createdRows) for (const [acc, v] of ledgerEffects(row)) merged.set(acc, (merged.get(acc) ?? 0) + v);
          await applyEffects(tx, userId, merged);
          eventIds.push(
            await enqueueEvent(tx, userId, "transactions.changed", {
              reason: "imported",
              transactionIds: createdRows.map((r) => r.id),
              dates: [...new Set(createdRows.map((r) => fromDbDate(r.transactionDate)))],
              categoryIds: [...new Set(createdRows.map((r) => r.categoryId).filter((x): x is string => !!x))],
              accountIds: [claimed.accountId],
              newExpenseIds: [],
            })
          );
        },
        { timeout: 120_000 }
      );
      imported += chunk.length;
    } catch (error) {
      if (error instanceof Error && error.message === "CONCURRENT_IMPORT") {
        // Rolled back; the other run owns these rows. Count what exists now.
        imported = await prisma.transaction.count({ where: { importJobId: jobId } });
      } else {
        for (const c of chunk) rejected.push({ rowIndex: c.importRowIndex!, reason: "Could not be saved" });
      }
    }
  }

  const status = rejected.length ? (imported > 0 ? "PARTIAL" : "FAILED") : "COMPLETED";
  await prisma.$transaction(async (tx) => {
    await tx.importJob.update({
      where: { id: jobId },
      data: {
        status,
        importedCount: imported,
        skippedCount: skipped,
        failedCount: rejected.length,
        summary: { rejected } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    await auditTx(tx, { userId, action: "IMPORT_COMPLETED", entity: "ImportJob", entityId: jobId, metadata: { imported, skipped, failed: rejected.length } });
    eventIds.push(await enqueueEvent(tx, userId, "import.completed", { importJobId: jobId, imported, skipped, failed: rejected.length }));
  });
  await dispatchEvents(eventIds);
  return getImportJob(userId, jobId, false);
}

/** Reverses an import: soft-deletes its transactions (balances restored). */
export async function undoImport(userId: string, jobId: string): Promise<{ deleted: number }> {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw ApiError.notFound("Import not found");
  const eventIds: string[] = [];
  const deleted = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.transaction.findMany({ where: { userId, importJobId: jobId, deletedAt: null } });
      const blocked = await tx.transaction.count({ where: { userId, originalTransactionId: { in: rows.map((r) => r.id) }, deletedAt: null } });
      if (blocked) throw ApiError.rule("Some imported purchases have refunds. Delete those refunds first.", "REFUNDS_EXIST");
      const merged = new Map<string, number>();
      for (const r of rows) for (const [acc, v] of ledgerEffects(r)) merged.set(acc, (merged.get(acc) ?? 0) - v);
      await tx.transaction.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await applyEffects(tx, userId, merged);
      await auditTx(tx, { userId, action: "TRANSACTION_DELETED", entity: "ImportJob", entityId: jobId, metadata: { count: rows.length, undoImport: true } });
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          reason: "deleted",
          transactionIds: rows.map((r) => r.id),
          dates: [...new Set(rows.map((r) => fromDbDate(r.transactionDate)))],
          categoryIds: [],
          accountIds: [job.accountId],
          newExpenseIds: [],
        })
      );
      return rows.length;
    },
    { timeout: 120_000 }
  );
  await dispatchEvents(eventIds);
  return { deleted };
}

// ---------------------------------------------------------------------------
// Saved mappings
// ---------------------------------------------------------------------------

export async function listMappings(userId: string) {
  const rows = await prisma.importMapping.findMany({ where: { userId }, orderBy: { name: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name, config: r.config as unknown as ImportMappingConfig }));
}

export async function saveMapping(userId: string, input: { name: string; config: ImportMappingConfig }) {
  const row = await prisma.importMapping.upsert({
    where: { userId_name: { userId, name: input.name } },
    update: { config: input.config as unknown as Prisma.InputJsonValue },
    create: { userId, name: input.name, config: input.config as unknown as Prisma.InputJsonValue },
  });
  return { id: row.id, name: row.name, config: row.config as unknown as ImportMappingConfig };
}

export async function deleteMapping(userId: string, id: string) {
  const r = await prisma.importMapping.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw ApiError.notFound("Preset not found");
}
