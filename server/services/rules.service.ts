import { Prisma, type AutomationRule } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { ruleShapeIssues, type RuleInput } from "@/lib/validation/schemas";
import type { TxClient } from "@/server/db/idempotency";
import { dispatchEvents, enqueueEvent } from "@/server/events/outbox";
import { auditTx } from "@/server/services/audit.service";
import { normalizeMerchantText, resolveMerchantId } from "@/server/services/merchant.service";
import { requireOwnedAccounts, requireOwnedCategory } from "@/server/services/ownership";
import { fromDbDate } from "@/lib/dates/date-only";

/**
 * Deterministic transaction rules: IF every configured condition matches THEN
 * apply the actions. Rules are evaluated in priority order (lower number first,
 * then oldest); the first match wins, so outcomes never depend on timing.
 *
 * SUGGEST rules only propose. AUTO rules fill EMPTY fields (category,
 * description) and add tags — they never overwrite a user's explicit choice.
 */

export interface RuleCandidate {
  merchant?: string | null;
  description?: string | null;
  amount?: number | null;
  accountId?: string | null;
  type?: string | null;
}

export function ruleMatches(rule: Pick<AutomationRule, "matchMerchant" | "matchDescription" | "minAmount" | "maxAmount" | "matchAccountId" | "matchType">, c: RuleCandidate): boolean {
  if (rule.matchMerchant && !normalizeMerchantText(c.merchant).includes(normalizeMerchantText(rule.matchMerchant))) return false;
  if (rule.matchDescription && !normalizeMerchantText(c.description).includes(normalizeMerchantText(rule.matchDescription))) return false;
  if (rule.minAmount != null && (c.amount == null || c.amount < Number(rule.minAmount))) return false;
  if (rule.maxAmount != null && (c.amount == null || c.amount > Number(rule.maxAmount))) return false;
  if (rule.matchAccountId && rule.matchAccountId !== c.accountId) return false;
  if (rule.matchType && rule.matchType !== c.type) return false;
  return true;
}

export function firstMatch<T extends Parameters<typeof ruleMatches>[0] & { priority: number; createdAt: Date }>(rules: T[], c: RuleCandidate): T | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
  return ordered.find((r) => ruleMatches(r, c)) ?? null;
}

/** "{merchant}" / "{amount}" placeholders in description templates. */
export function renderTemplate(template: string, c: RuleCandidate): string {
  return template
    .replace(/\{merchant\}/gi, c.merchant ?? "")
    .replace(/\{amount\}/gi, c.amount != null ? String(c.amount) : "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function activeRules(client: TxClient | typeof prisma, userId: string) {
  return client.automationRule.findMany({ where: { userId, active: true } });
}

export interface Suggestion {
  categoryId: string | null;
  tags: string[];
  merchantName: string | null;
  description: string | null;
  source:
    | { kind: "rule"; ruleId: string; ruleName: string; mode: "SUGGEST" | "AUTO" }
    | { kind: "history"; occurrences: number }
    | { kind: "merchant"; merchantName: string }
    | null;
}

/** Suggestion for a draft: matching rule → merchant history → merchant default category. */
export async function suggestFor(userId: string, c: RuleCandidate): Promise<Suggestion> {
  const rules = await activeRules(prisma, userId);
  const rule = firstMatch(rules, c);
  if (rule) {
    return {
      categoryId: rule.setCategoryId,
      tags: rule.addTags,
      merchantName: rule.setMerchantName,
      description: rule.descriptionTemplate ? renderTemplate(rule.descriptionTemplate, c) : null,
      source: { kind: "rule", ruleId: rule.id, ruleName: rule.name, mode: rule.mode },
    };
  }
  const merchant = normalizeMerchantText(c.merchant);
  if (merchant) {
    const rows = await prisma.$queryRaw<{ categoryId: string; n: bigint }[]>`
      SELECT t."categoryId", COUNT(*) AS n
      FROM "Transaction" t
      JOIN "Category" cat ON cat."id" = t."categoryId" AND cat."archivedAt" IS NULL
      WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."categoryId" IS NOT NULL
        AND LOWER(TRIM(t."merchant")) = ${merchant}
        ${c.type ? Prisma.sql`AND t."type"::text = ${c.type}` : Prisma.empty}
      GROUP BY t."categoryId" ORDER BY COUNT(*) DESC LIMIT 1`;
    if (rows[0]) {
      return { categoryId: rows[0].categoryId, tags: [], merchantName: null, description: null, source: { kind: "history", occurrences: Number(rows[0].n) } };
    }
    const merchantId = await resolveMerchantId(prisma, userId, c.merchant);
    if (merchantId) {
      const m = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, defaultCategoryId: true } });
      if (m?.defaultCategoryId) {
        return { categoryId: m.defaultCategoryId, tags: [], merchantName: m.name, description: null, source: { kind: "merchant", merchantName: m.name } };
      }
    }
  }
  return { categoryId: null, tags: [], merchantName: null, description: null, source: null };
}

export interface RuleDTO {
  id: string;
  name: string;
  priority: number;
  active: boolean;
  mode: "SUGGEST" | "AUTO";
  matchMerchant: string | null;
  matchDescription: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  matchAccountId: string | null;
  matchType: string | null;
  setCategoryId: string | null;
  setCategoryName: string | null;
  addTags: string[];
  setMerchantName: string | null;
  descriptionTemplate: string | null;
  appliedCount: number;
  lastAppliedAt: string | null;
}

function toDTO(r: AutomationRule & { setCategory: { name: string } | null }): RuleDTO {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    active: r.active,
    mode: r.mode,
    matchMerchant: r.matchMerchant,
    matchDescription: r.matchDescription,
    minAmount: r.minAmount != null ? Number(r.minAmount) : null,
    maxAmount: r.maxAmount != null ? Number(r.maxAmount) : null,
    matchAccountId: r.matchAccountId,
    matchType: r.matchType,
    setCategoryId: r.setCategoryId,
    setCategoryName: r.setCategory?.name ?? null,
    addTags: r.addTags,
    setMerchantName: r.setMerchantName,
    descriptionTemplate: r.descriptionTemplate,
    appliedCount: r.appliedCount,
    lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
  };
}

export async function listRules(userId: string): Promise<RuleDTO[]> {
  const rows = await prisma.automationRule.findMany({
    where: { userId },
    include: { setCategory: { select: { name: true } } },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDTO);
}

async function validateRefs(tx: TxClient, userId: string, input: Partial<RuleInput>) {
  if (input.matchAccountId) await requireOwnedAccounts(tx, userId, [{ path: "matchAccountId", id: input.matchAccountId, allowArchived: true }]);
  if (input.setCategoryId) await requireOwnedCategory(tx, userId, input.setCategoryId, input.matchType ?? "ANY", { path: "setCategoryId" });
}

function data(input: Partial<RuleInput>): Prisma.AutomationRuleUncheckedUpdateInput {
  const d: Prisma.AutomationRuleUncheckedUpdateInput = {};
  const keys = ["name", "priority", "active", "mode", "matchMerchant", "matchDescription", "matchAccountId", "matchType", "setCategoryId", "addTags", "setMerchantName", "descriptionTemplate"] as const;
  for (const k of keys) if (input[k] !== undefined) (d as Record<string, unknown>)[k] = input[k];
  if (input.minAmount !== undefined) d.minAmount = input.minAmount == null ? null : new Prisma.Decimal(input.minAmount.toFixed(2));
  if (input.maxAmount !== undefined) d.maxAmount = input.maxAmount == null ? null : new Prisma.Decimal(input.maxAmount.toFixed(2));
  return d;
}

export async function createRule(userId: string, input: RuleInput): Promise<RuleDTO> {
  const row = await prisma.$transaction(async (tx) => {
    await validateRefs(tx, userId, input);
    return tx.automationRule.create({
      data: { ...(data(input) as Prisma.AutomationRuleUncheckedCreateInput), userId, name: input.name },
      include: { setCategory: { select: { name: true } } },
    });
  });
  return toDTO(row);
}

export async function updateRule(userId: string, id: string, input: Partial<RuleInput>): Promise<RuleDTO> {
  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.automationRule.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("Rule not found");
    const merged = {
      matchMerchant: input.matchMerchant !== undefined ? input.matchMerchant : existing.matchMerchant,
      matchDescription: input.matchDescription !== undefined ? input.matchDescription : existing.matchDescription,
      minAmount: input.minAmount !== undefined ? input.minAmount : existing.minAmount != null ? Number(existing.minAmount) : null,
      maxAmount: input.maxAmount !== undefined ? input.maxAmount : existing.maxAmount != null ? Number(existing.maxAmount) : null,
      matchAccountId: input.matchAccountId !== undefined ? input.matchAccountId : existing.matchAccountId,
      setCategoryId: input.setCategoryId !== undefined ? input.setCategoryId : existing.setCategoryId,
      addTags: input.addTags ?? existing.addTags,
      setMerchantName: input.setMerchantName !== undefined ? input.setMerchantName : existing.setMerchantName,
      descriptionTemplate: input.descriptionTemplate !== undefined ? input.descriptionTemplate : existing.descriptionTemplate,
    };
    const issues = ruleShapeIssues(merged);
    if (issues.length) throw ApiError.validation(issues);
    await validateRefs(tx, userId, input);
    return tx.automationRule.update({ where: { id }, data: data(input), include: { setCategory: { select: { name: true } } } });
  });
  return toDTO(row);
}

export async function deleteRule(userId: string, id: string) {
  const r = await prisma.automationRule.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw ApiError.notFound("Rule not found");
}

/**
 * Applies one rule to existing transactions after an explicit preview.
 * scope "uncategorized" (default) only fills missing categories; scope "all"
 * re-categorises every match and must be chosen deliberately.
 */
export async function applyRule(userId: string, ruleId: string, opts: { scope: "uncategorized" | "all"; dryRun: boolean }) {
  const rule = await prisma.automationRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw ApiError.notFound("Rule not found");
  const candidates = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      isSplit: false,
      type: rule.matchType ? rule.matchType : { in: ["EXPENSE", "INCOME"] },
      ...(opts.scope === "uncategorized" ? { categoryId: null } : {}),
      ...(rule.matchMerchant ? { merchant: { contains: rule.matchMerchant, mode: "insensitive" } } : {}),
      ...(rule.matchDescription ? { description: { contains: rule.matchDescription, mode: "insensitive" } } : {}),
      ...(rule.matchAccountId ? { accountId: rule.matchAccountId } : {}),
    },
    orderBy: { transactionDate: "desc" },
    take: 5000,
  });
  const matches = candidates.filter((t) =>
    ruleMatches(rule, { merchant: t.merchant, description: t.description, amount: Number(t.amount), accountId: t.accountId, type: t.type })
  );
  const changes = matches.filter(
    (t) =>
      (rule.setCategoryId && t.categoryId !== rule.setCategoryId) ||
      rule.addTags.some((tag) => !t.tags.includes(tag)) ||
      (rule.descriptionTemplate && !t.description)
  );
  const sample = changes.slice(0, 10).map((t) => ({
    id: t.id,
    date: fromDbDate(t.transactionDate),
    merchant: t.merchant,
    description: t.description,
    amount: Number(t.amount),
  }));
  if (opts.dryRun || changes.length === 0) return { matched: matches.length, willChange: changes.length, sample, applied: 0 };

  const eventIds: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      let merchantId: string | null = null;
      if (rule.setMerchantName) {
        const m = await tx.merchant.upsert({
          where: { userId_name: { userId, name: rule.setMerchantName } },
          update: {},
          create: { userId, name: rule.setMerchantName },
        });
        merchantId = m.id;
      }
      for (const t of changes) {
        await tx.transaction.update({
          where: { id: t.id },
          data: {
            ...(rule.setCategoryId ? { categoryId: rule.setCategoryId } : {}),
            tags: [...new Set([...t.tags, ...rule.addTags])],
            ...(rule.descriptionTemplate && !t.description
              ? { description: renderTemplate(rule.descriptionTemplate, { merchant: t.merchant, amount: Number(t.amount) }) }
              : {}),
            ...(merchantId ? { merchantId } : {}),
            version: { increment: 1 },
          },
        });
      }
      await tx.automationRule.update({
        where: { id: rule.id },
        data: { appliedCount: { increment: changes.length }, lastAppliedAt: new Date() },
      });
      await auditTx(tx, { userId, action: "TRANSACTIONS_BULK_UPDATED", entity: "AutomationRule", entityId: rule.id, metadata: { count: changes.length } });
      eventIds.push(
        await enqueueEvent(tx, userId, "transactions.changed", {
          reason: "updated",
          transactionIds: changes.map((t) => t.id),
          dates: [...new Set(changes.map((t) => fromDbDate(t.transactionDate)))],
          categoryIds: [...new Set([rule.setCategoryId, ...changes.map((t) => t.categoryId)].filter((x): x is string => !!x))],
          accountIds: [],
          newExpenseIds: [],
        })
      );
    },
    { timeout: 60_000 }
  );
  await dispatchEvents(eventIds);
  return { matched: matches.length, willChange: changes.length, sample, applied: changes.length };
}
