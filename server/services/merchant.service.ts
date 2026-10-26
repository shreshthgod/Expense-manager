import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { addDays, fromDbDate, monthKey, trailingFinancialMonths, type ISODate } from "@/lib/dates/date-only";
import { round2 } from "@/lib/utils/money";
import type { TxClient } from "@/server/db/idempotency";
import { requireOwnedCategory } from "@/server/services/ownership";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Merchant normalisation. Raw text ("AMZN Mktp IN*123") is always kept on the
 * transaction; `merchantId` points at the normalised merchant ("Amazon") when a
 * user-defined alias or name matches.
 */

export function normalizeMerchantText(raw: string | null | undefined): string {
  return (raw ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

interface AliasIndex {
  patterns: { pattern: string; merchantId: string }[];
  names: Map<string, string>;
}

export async function loadAliasIndex(client: TxClient | typeof prisma, userId: string): Promise<AliasIndex> {
  const [aliases, merchants] = await Promise.all([
    client.merchantAlias.findMany({ where: { userId }, select: { pattern: true, merchantId: true } }),
    client.merchant.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  return {
    // Longest pattern first: "amazon prime" beats "amazon".
    patterns: aliases.map((a) => ({ pattern: normalizeMerchantText(a.pattern), merchantId: a.merchantId })).sort((a, b) => b.pattern.length - a.pattern.length),
    names: new Map(merchants.map((m) => [normalizeMerchantText(m.name), m.id])),
  };
}

export function matchMerchant(index: AliasIndex, raw: string | null | undefined): string | null {
  const text = normalizeMerchantText(raw);
  if (!text) return null;
  const exact = index.names.get(text);
  if (exact) return exact;
  for (const a of index.patterns) if (a.pattern && text.includes(a.pattern)) return a.merchantId;
  return null;
}

export async function resolveMerchantId(client: TxClient | typeof prisma, userId: string, raw: string | null | undefined): Promise<string | null> {
  if (!normalizeMerchantText(raw)) return null;
  return matchMerchant(await loadAliasIndex(client, userId), raw);
}

export interface MerchantDTO {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  defaultCategoryName: string | null;
  aliases: string[];
  stats: { total: number; count: number; average: number; lastDate: ISODate | null; last90Days: number };
}

async function statsFor(userId: string, merchantIds: string[], today: ISODate) {
  if (merchantIds.length === 0) return new Map<string, MerchantDTO["stats"]>();
  const since = addDays(today, -90);
  const rows = await prisma.$queryRaw<{ merchantId: string; total: Prisma.Decimal | null; cnt: bigint; last: Date | null; recent: Prisma.Decimal | null }[]>`
    SELECT t."merchantId",
      SUM(CASE WHEN t."type"::text = 'REFUND' THEN -t."amount" ELSE t."amount" END) AS total,
      COUNT(*) FILTER (WHERE t."type"::text = 'EXPENSE') AS cnt,
      MAX(t."transactionDate") AS last,
      SUM(CASE WHEN t."type"::text = 'REFUND' THEN -t."amount" ELSE t."amount" END) FILTER (WHERE t."transactionDate" >= ${since}::date) AS recent
    FROM "Transaction" t
    WHERE t."userId" = ${userId} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
      AND t."type"::text IN ('EXPENSE', 'REFUND') AND t."merchantId" IN (${Prisma.join(merchantIds)})
    GROUP BY t."merchantId"`;
  return new Map(
    rows.map((r) => {
      const total = round2(Number(r.total ?? 0));
      const count = Number(r.cnt);
      return [r.merchantId, { total, count, average: count ? round2(total / count) : 0, lastDate: r.last ? fromDbDate(r.last) : null, last90Days: round2(Number(r.recent ?? 0)) }];
    })
  );
}

export async function listMerchants(userId: string): Promise<MerchantDTO[]> {
  const today = todayFor(await getUserSettings(userId));
  const rows = await prisma.merchant.findMany({
    where: { userId },
    include: { aliases: { orderBy: { pattern: "asc" } }, defaultCategory: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const stats = await statsFor(userId, rows.map((r) => r.id), today);
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    defaultCategoryId: m.defaultCategoryId,
    defaultCategoryName: m.defaultCategory?.name ?? null,
    aliases: m.aliases.map((a) => a.pattern),
    stats: stats.get(m.id) ?? { total: 0, count: 0, average: 0, lastDate: null, last90Days: 0 },
  }));
}

/** Links existing transactions whose raw merchant text matches (only unlinked ones). */
async function backfill(tx: TxClient, userId: string): Promise<number> {
  const index = await loadAliasIndex(tx, userId);
  const candidates = await tx.transaction.findMany({
    where: { userId, merchantId: null, merchant: { not: null } },
    select: { id: true, merchant: true },
    take: 20_000,
  });
  const byMerchant = new Map<string, string[]>();
  for (const c of candidates) {
    const id = matchMerchant(index, c.merchant);
    if (id) byMerchant.set(id, [...(byMerchant.get(id) ?? []), c.id]);
  }
  let updated = 0;
  for (const [merchantId, ids] of byMerchant) {
    const r = await tx.transaction.updateMany({ where: { userId, id: { in: ids } }, data: { merchantId } });
    updated += r.count;
  }
  return updated;
}

async function assertAliasesFree(tx: TxClient, userId: string, aliases: string[], exceptMerchantId?: string) {
  if (!aliases.length) return;
  const clash = await tx.merchantAlias.findFirst({
    where: { userId, pattern: { in: aliases.map(normalizeMerchantText) }, ...(exceptMerchantId ? { merchantId: { not: exceptMerchantId } } : {}) },
    include: { merchant: { select: { name: true } } },
  });
  if (clash) throw ApiError.field("aliases", `"${clash.pattern}" already maps to ${clash.merchant.name}`);
}

export async function createMerchant(userId: string, input: { name: string; defaultCategoryId?: string | null; aliases: string[] }) {
  const result = await prisma.$transaction(async (tx) => {
    const clash = await tx.merchant.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } } });
    if (clash) throw ApiError.field("name", `You already have a merchant named "${clash.name}"`);
    await requireOwnedCategory(tx, userId, input.defaultCategoryId, "ANY", { path: "defaultCategoryId" });
    const aliases = [...new Set(input.aliases.map(normalizeMerchantText).filter(Boolean))];
    await assertAliasesFree(tx, userId, aliases);
    const m = await tx.merchant.create({
      data: {
        userId,
        name: input.name,
        defaultCategoryId: input.defaultCategoryId ?? null,
        aliases: { create: aliases.map((pattern) => ({ userId, pattern })) },
      },
    });
    const linked = await backfill(tx, userId);
    return { id: m.id, linked };
  });
  return result;
}

export async function updateMerchant(userId: string, id: string, input: { name?: string; defaultCategoryId?: string | null; aliases?: string[] }) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.merchant.findFirst({ where: { id, userId } });
    if (!m) throw ApiError.notFound("Merchant not found");
    if (input.name && input.name.toLowerCase() !== m.name.toLowerCase()) {
      const clash = await tx.merchant.findFirst({ where: { userId, id: { not: id }, name: { equals: input.name, mode: "insensitive" } } });
      if (clash) throw ApiError.field("name", `You already have a merchant named "${clash.name}"`);
    }
    if (input.defaultCategoryId !== undefined) await requireOwnedCategory(tx, userId, input.defaultCategoryId, "ANY", { path: "defaultCategoryId" });
    await tx.merchant.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.defaultCategoryId !== undefined ? { defaultCategoryId: input.defaultCategoryId } : {}),
      },
    });
    if (input.aliases) {
      const aliases = [...new Set(input.aliases.map(normalizeMerchantText).filter(Boolean))];
      await assertAliasesFree(tx, userId, aliases, id);
      await tx.merchantAlias.deleteMany({ where: { merchantId: id } });
      if (aliases.length) await tx.merchantAlias.createMany({ data: aliases.map((pattern) => ({ userId, merchantId: id, pattern })) });
      // Re-evaluate links: unlink this merchant's rows and re-match everything unlinked.
      await tx.transaction.updateMany({ where: { userId, merchantId: id }, data: { merchantId: null } });
    }
    const linked = await backfill(tx, userId);
    return { id, linked };
  });
}

/** Deleting a merchant never deletes transactions; they keep their original text. */
export async function deleteMerchant(userId: string, id: string) {
  const r = await prisma.merchant.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw ApiError.notFound("Merchant not found");
}

export async function getMerchantDetail(userId: string, id: string) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const [merchant] = (await listMerchants(userId)).filter((m) => m.id === id);
  if (!merchant) throw ApiError.notFound("Merchant not found");
  const months = trailingFinancialMonths(today, 12, settings.monthStartDay);
  const rows = await prisma.$queryRaw<{ month: string; total: Prisma.Decimal }[]>`
    SELECT to_char(t."transactionDate", 'YYYY-MM') AS month,
           SUM(CASE WHEN t."type"::text = 'REFUND' THEN -t."amount" ELSE t."amount" END) AS total
    FROM "Transaction" t
    WHERE t."userId" = ${userId} AND t."merchantId" = ${id} AND t."status" = 'POSTED' AND t."deletedAt" IS NULL
      AND t."type"::text IN ('EXPENSE', 'REFUND') AND t."transactionDate" >= ${months[0]!.start}::date
    GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.month, round2(Number(r.total))]));
  return {
    ...merchant,
    trend: months.map((m) => ({ month: monthKey(m.start), total: byMonth.get(monthKey(m.start)) ?? 0 })),
  };
}
