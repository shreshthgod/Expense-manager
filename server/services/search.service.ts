import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { fromDbDate } from "@/lib/dates/date-only";

/**
 * Global search across the user's records. Every query is userId-scoped and
 * parameterised; results are capped per group. Numeric queries also match
 * amounts (e.g. "499").
 */

export interface SearchResult {
  group: "Transactions" | "Merchants" | "Accounts" | "Categories" | "Tags" | "Bills & subscriptions" | "Goals" | "Reports";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  amount?: number;
  date?: string;
}

export async function globalSearch(userId: string, raw: string): Promise<SearchResult[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const amount = Number(q.replace(/[₹,\s]/g, ""));
  const isAmount = Number.isFinite(amount) && amount > 0 && /^[₹\d,.\s]+$/.test(q);

  const [transactions, merchants, accounts, categories, tags, recurring, goals, reports] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { merchant: contains },
          { description: contains },
          { notes: contains },
          ...(isAmount ? [{ amount: new Prisma.Decimal(amount.toFixed(2)) }] : []),
        ],
      },
      include: { category: { select: { name: true } }, account: { select: { name: true } } },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.$queryRaw<{ merchant: string; count: bigint }[]>`
      SELECT MIN(TRIM(t."merchant")) AS merchant, COUNT(*) AS count
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND t."merchant" ILIKE ${`%${q.replace(/[%_\\]/g, "\\$&")}%`}
      GROUP BY LOWER(TRIM(t."merchant")) ORDER BY COUNT(*) DESC LIMIT 5`,
    prisma.account.findMany({ where: { userId, OR: [{ name: contains }, { institution: contains }] }, take: 5 }),
    prisma.category.findMany({ where: { userId, name: contains }, take: 5 }),
    prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) AS count FROM "Transaction" t, unnest(t."tags") AS tag
      WHERE t."userId" = ${userId} AND t."deletedAt" IS NULL AND tag ILIKE ${`%${q.replace(/[%_\\]/g, "\\$&")}%`}
      GROUP BY tag ORDER BY COUNT(*) DESC LIMIT 5`,
    prisma.recurringTransaction.findMany({ where: { userId, OR: [{ name: contains }, { merchant: contains }] }, take: 5 }),
    prisma.savingsGoal.findMany({ where: { userId, name: contains }, take: 5 }),
    prisma.aIReport.findMany({ where: { userId, title: contains }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);

  const out: SearchResult[] = [];
  for (const t of transactions) {
    out.push({
      group: "Transactions",
      id: t.id,
      title: t.merchant ?? t.description ?? t.category?.name ?? t.type.toLowerCase(),
      subtitle: [t.category?.name, t.account?.name].filter(Boolean).join(" in ") || null,
      href: `/transactions?focus=${t.id}`,
      amount: Number(t.amount) * (t.type === "EXPENSE" ? -1 : 1),
      date: fromDbDate(t.transactionDate),
    });
  }
  for (const m of merchants) {
    out.push({ group: "Merchants", id: `m:${m.merchant}`, title: m.merchant, subtitle: `${m.count} transaction(s)`, href: `/transactions?merchant=${encodeURIComponent(m.merchant)}` });
  }
  for (const a of accounts) {
    out.push({ group: "Accounts", id: a.id, title: a.name, subtitle: a.institution, href: `/accounts/${a.id}`, amount: Number(a.balance) });
  }
  for (const c of categories) {
    out.push({ group: "Categories", id: c.id, title: c.name, subtitle: c.archivedAt ? "Archived" : null, href: `/transactions?categoryId=${c.id}` });
  }
  for (const t of tags) {
    out.push({ group: "Tags", id: `t:${t.tag}`, title: t.tag, subtitle: `${t.count} transaction(s)`, href: `/transactions?tag=${encodeURIComponent(t.tag)}` });
  }
  for (const r of recurring) {
    const kind = r.kind === "BILL" ? "Bill" : r.kind === "SUBSCRIPTION" ? "Subscription" : "Recurring";
    out.push({ group: "Bills & subscriptions", id: r.id, title: r.name ?? r.merchant ?? "Recurring item", subtitle: kind, href: `/recurring/${r.id}`, amount: -Number(r.amount) });
  }
  for (const g of goals) {
    out.push({ group: "Goals", id: g.id, title: g.name, subtitle: null, href: `/goals?focus=${g.id}` });
  }
  for (const r of reports) {
    out.push({ group: "Reports", id: r.id, title: r.title, subtitle: null, href: `/reports/${r.id}` });
  }
  return out;
}
