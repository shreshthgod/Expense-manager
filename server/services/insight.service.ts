import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { addDays, diffDays, financialMonthOf, lastDayOf, type DateRange, type ISODate } from "@/lib/dates/date-only";
import { formatMoney } from "@/lib/utils/format";
import { percentChange, round2 } from "@/lib/utils/money";
import { generateStructuredOutput, isAIAvailable } from "@/agents/provider";
import { INSIGHT_PROMPT } from "@/agents/prompts";
import { totalsForWindows } from "@/server/analytics/definitions";
import { getCategoryBreakdown } from "@/server/analytics/categories";
import { getBudgetStatuses } from "@/server/analytics/budget-status";
import { detectRecentAnomalies } from "@/server/analytics/detect";
import { listRecurring } from "@/server/services/recurring.service";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

/**
 * Explainable insight cards. Every card is produced by deterministic rules
 * from computed metrics and carries the evidence behind it ("Why am I seeing
 * this?"). AI may add a short narrative over the cards, never new numbers.
 */

export type InsightSeverity = "positive" | "info" | "warning";

export interface InsightCard {
  id: string;
  kind: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  metric: { label: string; value: number; unit: "money" | "percent" | "count" };
  comparison: { label: string; period: DateRange | null; value: number | null } | null;
  source: { description: string; period: DateRange | null };
  link: string | null;
  why: { label: string; value: string }[];
}

export interface InsightsResult {
  generatedAt: string;
  today: ISODate;
  cards: InsightCard[];
  narrative: { text: string; usedAI: boolean } | null;
}

/**
 * Month-to-date is compared with the SAME number of days of the previous
 * financial month, so a partial month is never compared with a full one.
 */
export async function getInsightCards(userId: string): Promise<InsightsResult> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const money = (n: number) => formatMoney(n, settings.currency);
  const month = financialMonthOf(today, settings.monthStartDay);
  const elapsed = diffDays(month.start, today) + 1;
  const mtd: DateRange = { start: month.start, end: addDays(today, 1) };
  const prevMonth = financialMonthOf(addDays(month.start, -1), settings.monthStartDay);
  const prevSameDays: DateRange = { start: prevMonth.start, end: addDays(prevMonth.start, Math.min(elapsed, diffDays(prevMonth.start, prevMonth.end))) };

  const [totals, categories, budgets, recurring, anomalies, uncategorized, bills] = await Promise.all([
    totalsForWindows(userId, [
      { key: "mtd", range: mtd },
      { key: "prev", range: prevSameDays },
    ]),
    getCategoryBreakdown(userId, mtd, prevSameDays, "EXPENSE"),
    getBudgetStatuses(userId, today, { weekStartsOn: settings.weekStartsOn }),
    listRecurring(userId, { includeInactive: false, today }),
    detectRecentAnomalies(userId, today, 30, money),
    prisma.transaction.count({ where: { userId, deletedAt: null, categoryId: null, isSplit: false, type: { in: ["EXPENSE", "INCOME"] } } }),
    prisma.recurringOccurrence.findMany({
      where: { userId, status: { in: ["DUE", "FAILED"] } },
      include: { recurring: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 20,
    }),
  ]);

  const cur = totals.get("mtd")!;
  const prev = totals.get("prev")!;
  const cards: InsightCard[] = [];
  const periodLabel = `${elapsed} day(s) of this month vs the same days last month`;

  // 1. Overall spending pace
  const spendChange = percentChange(prev.netSpending, cur.netSpending);
  if (spendChange != null && Math.abs(spendChange) >= 10 && Math.abs(cur.netSpending - prev.netSpending) >= 500) {
    cards.push({
      id: "spending-pace",
      kind: "spending_change",
      severity: spendChange > 0 ? "warning" : "positive",
      title: `Spending is ${Math.abs(spendChange)}% ${spendChange > 0 ? "higher" : "lower"} than last month`,
      body: `${money(cur.netSpending)} so far vs ${money(prev.netSpending)} at the same point last month.`,
      metric: { label: "Net spending so far", value: cur.netSpending, unit: "money" },
      comparison: { label: "Same days last month", period: prevSameDays, value: prev.netSpending },
      source: { description: "Posted expenses minus refunds", period: mtd },
      link: `/transactions?type=EXPENSE&startDate=${mtd.start}&endDate=${today}`,
      why: [
        { label: "This month so far", value: money(cur.netSpending) },
        { label: "Same days last month", value: money(prev.netSpending) },
        { label: "Change", value: `${spendChange > 0 ? "+" : ""}${spendChange}%` },
        { label: "Comparison", value: periodLabel },
      ],
    });
  }

  // 2. Biggest category mover
  const mover = categories
    .filter((c) => c.previousTotal > 0 && c.changePct != null && Math.abs(c.total - c.previousTotal) >= 500)
    .sort((a, b) => Math.abs(b.total - b.previousTotal) - Math.abs(a.total - a.previousTotal))[0];
  if (mover && mover.changePct != null && Math.abs(mover.changePct) >= 15) {
    cards.push({
      id: `category-${mover.categoryId ?? "none"}`,
      kind: "category_change",
      severity: mover.changePct > 0 ? "warning" : "positive",
      title: `${mover.name} spending is ${Math.abs(mover.changePct)}% ${mover.changePct > 0 ? "higher" : "lower"}`,
      body: `${money(mover.total)} so far this month vs ${money(mover.previousTotal)} at the same point last month.`,
      metric: { label: `${mover.name} so far`, value: mover.total, unit: "money" },
      comparison: { label: "Same days last month", period: prevSameDays, value: mover.previousTotal },
      source: { description: `${mover.count} transaction(s) in ${mover.name}`, period: mtd },
      link: mover.categoryId ? `/transactions?categoryId=${mover.categoryId}&startDate=${mtd.start}&endDate=${today}` : null,
      why: [
        { label: "This month so far", value: money(mover.total) },
        { label: "Same days last month", value: money(mover.previousTotal) },
        { label: "Transactions", value: String(mover.count) },
      ],
    });
  }

  // 3. Budget pace / overspend
  for (const b of budgets.filter((x) => x.cycle.state === "active" && (x.exceeded || x.aheadOfPace)).slice(0, 2)) {
    cards.push({
      id: `budget-${b.id}`,
      kind: "budget_risk",
      severity: "warning",
      title: b.exceeded ? `${b.name} budget exceeded` : `${b.name} budget is ${b.utilization}% used`,
      body: b.exceeded
        ? `${money(b.spent)} of ${money(b.amount)} spent — ${money(b.spent - b.amount)} over.`
        : `${b.utilization}% used with ${b.elapsedPct}% of the cycle elapsed. At this pace: ${money(b.projectedSpend)}.`,
      metric: { label: "Used", value: b.utilization ?? 0, unit: "percent" },
      comparison: { label: "Cycle elapsed", period: { start: b.cycle.start, end: b.cycle.end }, value: b.elapsedPct },
      source: { description: `${b.name} budget, cycle ${b.cycle.start} → ${b.cycle.lastDay}`, period: { start: b.cycle.start, end: b.cycle.end } },
      link: `/budgets?focus=${b.id}`,
      why: [
        { label: "Spent", value: money(b.spent) },
        { label: "Limit", value: money(b.amount) },
        { label: "Days left", value: String(b.daysRemaining) },
        { label: "Projected at current pace", value: money(b.projectedSpend) },
      ],
    });
  }

  // 4. Subscriptions (factual cost, no cancellation advice)
  const subs = recurring.filter((r) => r.kind === "SUBSCRIPTION" && r.type === "EXPENSE");
  if (subs.length) {
    const monthly = round2(subs.reduce((a, s) => a + s.monthlyEquivalent, 0));
    cards.push({
      id: "subscriptions",
      kind: "subscriptions",
      severity: "info",
      title: `Subscriptions cost about ${money(monthly)} a month`,
      body: `${subs.length} active subscription(s), about ${money(monthly * 12)} a year.`,
      metric: { label: "Monthly equivalent", value: monthly, unit: "money" },
      comparison: null,
      source: { description: "Active subscriptions converted to a monthly equivalent (planning estimate)", period: null },
      link: "/subscriptions",
      why: subs.slice(0, 6).map((s) => ({ label: s.name, value: `${money(s.monthlyEquivalent)}/month` })),
    });
  }

  // 5. Unusual expenses
  if (anomalies.length) {
    cards.push({
      id: "anomalies",
      kind: "anomalies",
      severity: "info",
      title: `${anomalies.length} unusually large expense${anomalies.length > 1 ? "s" : ""} in the last 30 days`,
      body: anomalies[0]!.reason,
      metric: { label: "Unusual expenses", value: anomalies.length, unit: "count" },
      comparison: null,
      source: { description: "Each compared with your previous 90 days in the same category", period: { start: addDays(today, -30), end: addDays(today, 1) } },
      link: `/transactions?focus=${anomalies[0]!.transactionId}`,
      why: anomalies.slice(0, 5).map((a) => ({ label: `${a.merchant ?? a.categoryName ?? "Expense"} · ${a.transactionDate}`, value: `${money(a.amount)} (${a.ratio}× typical)` })),
    });
  }

  // 6. Savings rate
  if (cur.savingsRate != null && cur.income > 0) {
    cards.push({
      id: "savings-rate",
      kind: "savings_rate",
      severity: cur.savingsRate >= 20 ? "positive" : cur.savingsRate < 0 ? "warning" : "info",
      title: `You've kept ${cur.savingsRate}% of this month's income so far`,
      body: `Income ${money(cur.income)}, net spending ${money(cur.netSpending)}, surplus ${money(cur.surplus)}.`,
      metric: { label: "Savings rate", value: cur.savingsRate, unit: "percent" },
      comparison: prev.savingsRate != null ? { label: "Same days last month", period: prevSameDays, value: prev.savingsRate } : null,
      source: { description: "Surplus ÷ income for posted transactions", period: mtd },
      link: "/analytics",
      why: [
        { label: "Income", value: money(cur.income) },
        { label: "Net spending", value: money(cur.netSpending) },
        { label: "Surplus", value: money(cur.surplus) },
      ],
    });
  }

  // 7. Bills awaiting payment
  if (bills.length) {
    const overdue = bills.filter((o) => o.dueDate.toISOString().slice(0, 10) < today);
    const total = round2(bills.reduce((a, o) => a + Number(o.amount), 0));
    cards.push({
      id: "bills-due",
      kind: "bills_due",
      severity: overdue.length ? "warning" : "info",
      title: overdue.length ? `${overdue.length} payment(s) overdue` : `${bills.length} payment(s) awaiting confirmation`,
      body: `${money(total)} across ${bills.map((b) => b.recurring.name ?? "item").slice(0, 3).join(", ")}${bills.length > 3 ? "…" : ""}.`,
      metric: { label: "Awaiting payment", value: total, unit: "money" },
      comparison: null,
      source: { description: "Bill and reminder occurrences not yet marked paid", period: null },
      link: "/bills",
      why: bills.slice(0, 6).map((b) => ({ label: `${b.recurring.name ?? "Item"} · due ${b.dueDate.toISOString().slice(0, 10)}`, value: money(Number(b.amount)) })),
    });
  }

  // 8. Needs review
  if (uncategorized > 0) {
    cards.push({
      id: "uncategorized",
      kind: "uncategorized",
      severity: "info",
      title: `${uncategorized} transaction(s) need a category`,
      body: "Uncategorised transactions are left out of category budgets and trends until you categorise them.",
      metric: { label: "Uncategorised", value: uncategorized, unit: "count" },
      comparison: null,
      source: { description: "Expenses and income without a category", period: null },
      link: "/inbox",
      why: [{ label: "Uncategorised transactions", value: String(uncategorized) }],
    });
  }

  return { generatedAt: new Date().toISOString(), today, cards, narrative: null };
}

const narrativeSchema = z.object({ text: z.string().min(1).max(600) });
const cache = new Map<string, { value: { text: string; usedAI: boolean }; expiresAt: number; key: string }>();
const TTL_MS = 30 * 60 * 1000;

/**
 * Optional one-paragraph summary of the cards. Uses only the cards' own text
 * and numbers. Without an AI provider it returns null (the cards stand alone).
 */
export async function getInsightsWithNarrative(userId: string): Promise<InsightsResult> {
  const result = await getInsightCards(userId);
  if (!isAIAvailable() || result.cards.length === 0) return result;
  const fingerprint = JSON.stringify(result.cards.map((c) => [c.id, c.metric.value]));
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now() && cached.key === fingerprint) return { ...result, narrative: cached.value };

  const facts = result.cards.map((c) => ({ title: c.title, detail: c.body }));
  const { value, usedAI } = await generateStructuredOutput(
    {
      messages: [
        { role: "system", content: INSIGHT_PROMPT },
        { role: "user", content: `FACTS (computed; use only these numbers):\n${JSON.stringify(facts)}` },
      ],
      temperature: 0.3,
      maxTokens: 160,
    },
    narrativeSchema,
    { text: "" }
  );
  if (!usedAI || !value.text) return result;
  const narrative = { text: value.text, usedAI: true };
  cache.set(userId, { value: narrative, expiresAt: Date.now() + TTL_MS, key: fingerprint });
  return { ...result, narrative };
}

/** Deterministic context for "Analyze this transaction". */
export async function explainTransaction(userId: string, transactionId: string) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const money = (n: number) => formatMoney(n, settings.currency);
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId, deletedAt: null },
    include: { category: true, account: true },
  });
  if (!tx) return null;
  const date = tx.transactionDate.toISOString().slice(0, 10);
  const since = addDays(date, -90);
  const [sameCategory, sameMerchant] = await Promise.all([
    tx.categoryId
      ? prisma.transaction.aggregate({
          where: { userId, deletedAt: null, status: "POSTED", type: tx.type, categoryId: tx.categoryId, id: { not: tx.id }, transactionDate: { gte: new Date(`${since}T00:00:00Z`), lte: tx.transactionDate } },
          _avg: { amount: true },
          _count: true,
          _max: { amount: true },
        })
      : null,
    tx.merchant
      ? prisma.transaction.aggregate({
          where: { userId, deletedAt: null, status: "POSTED", merchant: { equals: tx.merchant, mode: "insensitive" }, id: { not: tx.id } },
          _avg: { amount: true },
          _count: true,
          _sum: { amount: true },
        })
      : null,
  ]);
  const amount = Number(tx.amount);
  const facts: { label: string; value: string }[] = [
    { label: "Amount", value: money(amount) },
    { label: "Date", value: date },
  ];
  if (sameCategory && sameCategory._count > 0) {
    const avg = Number(sameCategory._avg.amount ?? 0);
    facts.push({ label: `Typical ${tx.category?.name ?? "category"} amount (90 days)`, value: money(avg) });
    facts.push({ label: "Compared with typical", value: avg > 0 ? `${round2(amount / avg)}×` : "—" });
    facts.push({ label: "Largest in 90 days", value: money(Number(sameCategory._max.amount ?? 0)) });
  }
  if (sameMerchant && sameMerchant._count > 0) {
    facts.push({ label: `Other purchases at ${tx.merchant}`, value: String(sameMerchant._count) });
    facts.push({ label: `Average at ${tx.merchant}`, value: money(Number(sameMerchant._avg.amount ?? 0)) });
    facts.push({ label: `Total at ${tx.merchant} (all time)`, value: money(Number(sameMerchant._sum.amount ?? 0) + amount) });
  }
  return { transactionId, today, facts, period: { start: since, end: addDays(date, 1), lastDay: lastDayOf({ start: since, end: addDays(date, 1) }) } };
}
