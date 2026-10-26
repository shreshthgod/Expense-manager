import { Prisma, type AccountType } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { accountTypeMeta } from "@/lib/constants";
import {
  addDays,
  addMonthsClamped,
  diffDays,
  financialMonthOf,
  fromDbDate,
  lastDayOf,
  toDbDate,
  trailingFinancialMonths,
  type DateRange,
  type ISODate,
} from "@/lib/dates/date-only";
import { fromMinor, round2, toMinor } from "@/lib/utils/money";
import { POSTED_ACTIVE, signedEffectOn } from "@/server/ledger/sql";
import { allocations } from "@/server/analytics/allocations";
import { SPEND_SIGN, totalsForWindows } from "@/server/analytics/definitions";
import { getCardStatement } from "@/server/services/account.service";
import { listScheduledItems } from "@/server/services/recurring.service";
import { getUserSettings, todayFor, type UserSettings } from "@/server/services/user-settings.service";

/**
 * PLANNING DEFINITIONS (documented in BUSINESS_LOGIC.md):
 *
 *   liquid         = Σ balances of BANK, SAVINGS, CASH, WALLET accounts (not archived-excluded)
 *   commitments    = scheduled outflows from liquid accounts that are not yet
 *                    recorded (overdue + due through the horizon), PLANNED
 *                    transactions, and unpaid credit-card statement dues with no
 *                    scheduled payment inside the horizon
 *   safe-to-spend  = liquid − commitments(to month end) − goal plans still due this month
 *                    (expected income is shown separately and only added when asked)
 *   essential spend= net spending in ESSENTIAL categories (avg of last 3 complete months)
 *   emergency months = emergency fund / essential monthly spend
 *
 * Projections never change stored data and never count a scheduled item twice
 * (occurrences are keyed by rule + date; PLANNED rows linked to an occurrence
 * are skipped).
 */

// ---------------------------------------------------------------------------
// Net worth & balance history
// ---------------------------------------------------------------------------

export interface NetWorthPoint {
  date: ISODate;
  assets: number;
  liabilities: number;
  netWorth: number;
  liquid: number;
}

/**
 * Net worth at the end of each date in `dates` in ONE query. An account counts
 * from its opening date onward (before that it wasn't tracked).
 */
export async function netWorthAt(userId: string, dates: ISODate[]): Promise<NetWorthPoint[]> {
  if (!dates.length) return [];
  const rows = await prisma.$queryRaw<{ d: Date; accountId: string; type: string; bal: Prisma.Decimal }[]>`
    WITH d AS (SELECT unnest(${dates}::text[]::date[]) AS d)
    SELECT d.d, a."id" AS "accountId", a."type"::text AS type,
      a."openingBalance" + COALESCE((
        SELECT SUM(${signedEffectOn(Prisma.sql`a."id"`)})
        FROM "Transaction" t
        WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
          AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
          AND t."transactionDate" <= d.d
      ), 0) AS bal
    FROM d CROSS JOIN "Account" a
    WHERE a."userId" = ${userId} AND a."includeInNetWorth" = true AND a."openingDate" <= d.d`;
  const by = new Map<ISODate, { assets: number; liabilities: number; liquid: number }>();
  for (const date of dates) by.set(date, { assets: 0, liabilities: 0, liquid: 0 });
  for (const r of rows) {
    const key = fromDbDate(r.d);
    const agg = by.get(key)!;
    const minor = toMinor(r.bal.toString());
    const meta = accountTypeMeta(r.type as AccountType);
    if (meta.group === "LIABILITY") agg.liabilities += -minor;
    else agg.assets += minor;
    if (meta.liquid) agg.liquid += minor;
  }
  return dates.map((date) => {
    const a = by.get(date)!;
    return {
      date,
      assets: fromMinor(a.assets),
      liabilities: fromMinor(a.liabilities),
      netWorth: fromMinor(a.assets - a.liabilities),
      liquid: fromMinor(a.liquid),
    };
  });
}

/** Month-end net worth for the last `months` financial months (the current month ends today). */
export async function getNetWorthHistory(userId: string, months = 12) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const ranges = trailingFinancialMonths(today, months, settings.monthStartDay);
  const dates = ranges.map((r) => (lastDayOf(r) > today ? today : lastDayOf(r)));
  const points = await netWorthAt(userId, dates);
  const accounts = await prisma.account.findMany({
    where: { userId, includeInNetWorth: true },
    select: { id: true, name: true, type: true, balance: true, archivedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    change: first && last ? fromMinor(toMinor(last.netWorth) - toMinor(first.netWorth)) : 0,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      group: accountTypeMeta(a.type).group,
      balance: Number(a.balance),
      archived: a.archivedAt != null,
    })),
  };
}

/** Daily end-of-day balance of one account over the last `days` days. */
export async function getAccountBalanceHistory(userId: string, accountId: string, days = 90) {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const from = addDays(today, -(days - 1));
  const account = await prisma.account.findFirst({ where: { id: accountId, userId }, select: { id: true } });
  if (!account) throw ApiError.notFound("Account not found");
  const rows = await prisma.$queryRaw<{ d: Date; bal: Prisma.Decimal }[]>`
    WITH d AS (SELECT generate_series(${from}::date, ${today}::date, interval '1 day')::date AS d),
    base AS (
      SELECT a."openingBalance" + COALESCE((
        SELECT SUM(${signedEffectOn(Prisma.sql`a."id"`)}) FROM "Transaction" t
        WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
          AND (t."accountId" = a."id" OR t."destinationAccountId" = a."id")
          AND t."transactionDate" < ${from}::date), 0) AS opening
      FROM "Account" a WHERE a."id" = ${accountId}
    ),
    daily AS (
      SELECT t."transactionDate" AS d, SUM(${signedEffectOn(Prisma.sql`${accountId}`)}) AS delta
      FROM "Transaction" t
      WHERE t."userId" = ${userId} AND ${POSTED_ACTIVE}
        AND (t."accountId" = ${accountId} OR t."destinationAccountId" = ${accountId})
        AND t."transactionDate" >= ${from}::date AND t."transactionDate" <= ${today}::date
      GROUP BY t."transactionDate"
    )
    SELECT d.d, (SELECT opening FROM base) + COALESCE(SUM(daily.delta) OVER (ORDER BY d.d), 0) AS bal
    FROM d LEFT JOIN daily ON daily.d = d.d
    ORDER BY d.d`;
  return rows.map((r) => ({ date: fromDbDate(r.d), balance: round2(Number(r.bal)) }));
}

// ---------------------------------------------------------------------------
// Cash-flow projection
// ---------------------------------------------------------------------------

export interface ProjectionItem {
  key: string;
  date: ISODate;
  name: string;
  /** Signed effect on liquid money. */
  amount: number;
  source: "scheduled" | "planned" | "card_due";
  kind: string;
  overdue: boolean;
  income: boolean;
  ruleId: string | null;
  transactionId: string | null;
}

export interface CashFlowProjection {
  from: ISODate;
  to: ISODate;
  startingLiquid: number;
  includeExpectedIncome: boolean;
  days: { date: ISODate; inflow: number; outflow: number; balance: number }[];
  items: ProjectionItem[];
  lowest: { date: ISODate; balance: number };
  firstNegativeDate: ISODate | null;
  endingBalance: number;
  totals: { inflow: number; outflow: number; expectedIncome: number };
  assumptions: string[];
}

async function liquidAccounts(userId: string) {
  const accounts = await prisma.account.findMany({ where: { userId }, select: { id: true, type: true, balance: true, name: true, statementDay: true, archivedAt: true } });
  const liquid = accounts.filter((a) => accountTypeMeta(a.type).liquid);
  return {
    accounts,
    liquidIds: new Set(liquid.map((a) => a.id)),
    liquidBalance: fromMinor(liquid.reduce((s, a) => s + toMinor(a.balance.toString()), 0)),
  };
}

/** Signed effect of a movement on the set of liquid accounts. */
function liquidEffect(liquidIds: Set<string>, type: string, amount: number, accountId: string | null, destinationAccountId: string | null): number {
  const src = accountId != null && liquidIds.has(accountId);
  const dst = destinationAccountId != null && liquidIds.has(destinationAccountId);
  switch (type) {
    case "EXPENSE":
      return src ? -amount : 0;
    case "INCOME":
    case "REFUND":
      return src ? amount : 0;
    case "TRANSFER":
      return (dst ? amount : 0) - (src ? amount : 0);
    default:
      return 0;
  }
}

/**
 * Collects future liquid-money movements between today and `to` (exclusive):
 * outstanding scheduled occurrences (overdue ones are placed on today), PLANNED
 * transactions not linked to an occurrence, and credit-card dues without a
 * scheduled payment in the window.
 */
export async function projectionItems(userId: string, today: ISODate, to: ISODate, liquidIds: Set<string>, accounts: { id: string; type: string; name: string }[]) {
  const lookback = addDays(today, -60);
  const [scheduled, planned] = await Promise.all([
    listScheduledItems(userId, lookback, to),
    prisma.transaction.findMany({
      where: { userId, status: "PLANNED", deletedAt: null, transactionDate: { lt: toDbDate(to) } },
      select: { id: true, type: true, amount: true, accountId: true, destinationAccountId: true, transactionDate: true, description: true, merchant: true },
    }),
  ]);
  const linked = new Set(scheduled.map((s) => s.transactionId).filter(Boolean));
  const items: ProjectionItem[] = [];
  for (const s of scheduled) {
    const outstanding = s.status === "EXPECTED" || s.status === "SCHEDULED" || s.status === "DUE" || s.status === "FAILED";
    if (!outstanding) continue;
    if (s.date < today && s.status === "EXPECTED") continue; // never-materialised past dates are not debts
    const amount = liquidEffect(liquidIds, s.type, s.amount, s.accountId, s.destinationAccountId);
    if (amount === 0) continue;
    items.push({
      key: `s:${s.key}`,
      date: s.date < today ? today : s.date,
      name: s.name,
      amount,
      source: "scheduled",
      kind: s.kind,
      overdue: s.date < today,
      income: s.type === "INCOME",
      ruleId: s.ruleId,
      transactionId: null,
    });
  }
  for (const p of planned) {
    if (linked.has(p.id)) continue;
    const amount = liquidEffect(liquidIds, p.type, Number(p.amount), p.accountId, p.destinationAccountId);
    if (amount === 0) continue;
    const date = fromDbDate(p.transactionDate);
    items.push({
      key: `p:${p.id}`,
      date: date < today ? today : date,
      name: p.description ?? p.merchant ?? "Planned transaction",
      amount,
      source: "planned",
      kind: "PLANNED",
      overdue: date < today,
      income: p.type === "INCOME",
      ruleId: null,
      transactionId: p.id,
    });
  }
  // Credit-card dues: only when nothing already schedules a payment to that card.
  const scheduledCardPayments = new Set(
    scheduled.filter((s) => s.type === "TRANSFER" && s.destinationAccountId && s.date >= today).map((s) => s.destinationAccountId)
  );
  for (const card of accounts.filter((a) => a.type === "CREDIT_CARD")) {
    if (scheduledCardPayments.has(card.id)) continue;
    const st = await getCardStatement(userId, card.id).catch(() => null);
    if (!st || !st.nextDueDate || st.amountDue <= 0 || st.nextDueDate >= to) continue;
    items.push({
      key: `c:${card.id}:${st.nextDueDate}`,
      date: st.nextDueDate < today ? today : st.nextDueDate,
      name: `${card.name} statement due`,
      amount: -st.amountDue,
      source: "card_due",
      kind: "CARD",
      overdue: st.nextDueDate < today,
      income: false,
      ruleId: null,
      transactionId: null,
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
}

export async function getCashFlowProjection(userId: string, opts: { days?: number; includeExpectedIncome?: boolean } = {}): Promise<CashFlowProjection> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const days = opts.days ?? 45;
  const includeIncome = opts.includeExpectedIncome ?? true;
  const to = addDays(today, days);
  const { accounts, liquidIds, liquidBalance } = await liquidAccounts(userId);
  const all = await projectionItems(userId, today, to, liquidIds, accounts);
  const items = all.filter((i) => includeIncome || i.amount < 0);
  const byDay = new Map<ISODate, { inflow: number; outflow: number }>();
  for (const i of items) {
    const d = byDay.get(i.date) ?? { inflow: 0, outflow: 0 };
    if (i.amount > 0) d.inflow += toMinor(i.amount);
    else d.outflow += toMinor(-i.amount);
    byDay.set(i.date, d);
  }
  let balance = toMinor(liquidBalance);
  let lowest = { date: today, balance: liquidBalance };
  let firstNegativeDate: ISODate | null = null;
  const series: CashFlowProjection["days"] = [];
  for (let d = today; d < to; d = addDays(d, 1)) {
    const flow = byDay.get(d) ?? { inflow: 0, outflow: 0 };
    balance += flow.inflow - flow.outflow;
    const b = fromMinor(balance);
    series.push({ date: d, inflow: fromMinor(flow.inflow), outflow: fromMinor(flow.outflow), balance: b });
    if (b < lowest.balance) lowest = { date: d, balance: b };
    if (b < 0 && !firstNegativeDate) firstNegativeDate = d;
  }
  const inflow = items.filter((i) => i.amount > 0).reduce((s, i) => s + toMinor(i.amount), 0);
  const outflow = items.filter((i) => i.amount < 0).reduce((s, i) => s - toMinor(i.amount), 0);
  const expectedIncome = all.filter((i) => i.amount > 0).reduce((s, i) => s + toMinor(i.amount), 0);
  return {
    from: today,
    to,
    startingLiquid: liquidBalance,
    includeExpectedIncome: includeIncome,
    days: series,
    items,
    lowest,
    firstNegativeDate,
    endingBalance: fromMinor(balance),
    totals: { inflow: fromMinor(inflow), outflow: fromMinor(outflow), expectedIncome: fromMinor(expectedIncome) },
    assumptions: [
      "Starts from today's balance of your bank, savings, cash and wallet accounts.",
      "Includes bills, subscriptions, recurring items and planned transactions that aren't recorded yet; overdue items are placed on today.",
      "Credit-card statement dues are included only when no payment to that card is already scheduled.",
      includeIncome ? "Expected recurring income is included on its scheduled date." : "Expected income is not included.",
      "Everyday spending that isn't scheduled is not projected.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Safe to spend
// ---------------------------------------------------------------------------

export interface SafeToSpend {
  period: DateRange & { lastDay: ISODate };
  daysLeft: number;
  liquid: number;
  commitments: number;
  goalPlans: number;
  expectedIncome: number;
  /** liquid − commitments − goalPlans (never includes expected income). */
  safeToSpend: number;
  /** safeToSpend + expectedIncome, shown as "if expected income arrives". */
  safeToSpendWithIncome: number;
  perDay: number | null;
  lines: { label: string; amount: number; items?: ProjectionItem[] }[];
  formula: string;
}

export async function getSafeToSpend(userId: string): Promise<SafeToSpend> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const month = financialMonthOf(today, settings.monthStartDay);
  const { accounts, liquidIds, liquidBalance } = await liquidAccounts(userId);
  const items = await projectionItems(userId, today, month.end, liquidIds, accounts);
  const outflows = items.filter((i) => i.amount < 0);
  const inflows = items.filter((i) => i.amount > 0);
  const commitments = outflows.reduce((s, i) => s - toMinor(i.amount), 0);
  const expectedIncome = inflows.reduce((s, i) => s + toMinor(i.amount), 0);

  // Planned goal contributions not yet made this month.
  const goals = await prisma.savingsGoal.findMany({
    where: { userId, archivedAt: null, completedAt: null, monthlyContribution: { not: null } },
    select: { id: true, name: true, monthlyContribution: true },
  });
  const contributed = goals.length
    ? await prisma.goalContribution.groupBy({
        by: ["goalId"],
        where: { userId, goalId: { in: goals.map((g) => g.id) }, date: { gte: toDbDate(month.start), lt: toDbDate(month.end) } },
        _sum: { amount: true },
      })
    : [];
  const done = new Map(contributed.map((c) => [c.goalId, toMinor((c._sum.amount ?? 0).toString())]));
  const goalLines = goals
    .map((g) => ({ name: g.name, left: Math.max(0, toMinor(g.monthlyContribution!.toString()) - (done.get(g.id) ?? 0)) }))
    .filter((g) => g.left > 0);
  const goalPlans = goalLines.reduce((s, g) => s + g.left, 0);

  const safe = toMinor(liquidBalance) - commitments - goalPlans;
  const daysLeft = Math.max(1, diffDays(today, month.end));
  return {
    period: { ...month, lastDay: lastDayOf(month) },
    daysLeft,
    liquid: liquidBalance,
    commitments: fromMinor(commitments),
    goalPlans: fromMinor(goalPlans),
    expectedIncome: fromMinor(expectedIncome),
    safeToSpend: fromMinor(safe),
    safeToSpendWithIncome: fromMinor(safe + expectedIncome),
    perDay: safe > 0 ? fromMinor(Math.floor(safe / daysLeft)) : null,
    lines: [
      { label: "Money in bank, savings, cash and wallets", amount: liquidBalance },
      { label: "Bills, subscriptions and planned payments until month end", amount: -fromMinor(commitments), items: outflows },
      ...(goalPlans ? [{ label: `Goal contributions still planned this month (${goalLines.map((g) => g.name).join(", ")})`, amount: -fromMinor(goalPlans) }] : []),
    ],
    formula: "Safe to spend = liquid balance − unrecorded commitments until the end of this financial month − remaining planned goal contributions. Expected income is not counted until it arrives.",
  };
}

// ---------------------------------------------------------------------------
// Emergency fund
// ---------------------------------------------------------------------------

export interface EmergencyFundStatus {
  essentialMonthly: number;
  essentialSource: "essential_categories" | "all_spending";
  monthsUsed: number;
  fund: number;
  fundSource: "emergency_goals" | "liquid_balance";
  monthsCovered: number | null;
  targetMonths: number;
  targetAmount: number;
  shortfall: number;
  assumptions: string[];
}

/** Average essential spending over the last 3 complete financial months. */
export async function essentialMonthlySpend(userId: string, today: ISODate, settings: Pick<UserSettings, "monthStartDay">) {
  const current = financialMonthOf(today, settings.monthStartDay);
  const months = trailingFinancialMonths(addDays(current.start, -1), 3, settings.monthStartDay);
  const from = months[0].start;
  const to = current.start;
  const rows = await prisma.$queryRaw<{ essential: Prisma.Decimal | null; total: Prisma.Decimal | null; tagged: bigint; active: bigint }[]>`
    SELECT
      SUM(${SPEND_SIGN} * t."amount") FILTER (WHERE c."spendingClass"::text = 'ESSENTIAL') AS essential,
      SUM(${SPEND_SIGN} * t."amount") AS total,
      (SELECT COUNT(*) FROM "Category" cc WHERE cc."userId" = ${userId} AND cc."spendingClass" IS NOT NULL) AS tagged,
      COUNT(DISTINCT date_trunc('month', t."transactionDate")) AS active
    FROM (${allocations(userId)}) t
    LEFT JOIN "Category" c ON c."id" = t."categoryId"
    WHERE t."type"::text IN ('EXPENSE', 'REFUND') AND t."transactionDate" >= ${from}::date AND t."transactionDate" < ${to}::date`;
  const r = rows[0];
  const monthsUsed = Math.min(3, Number(r?.active ?? 0));
  const tagged = Number(r?.tagged ?? 0) > 0;
  const base = tagged ? Number(r?.essential ?? 0) : Number(r?.total ?? 0);
  return {
    monthly: monthsUsed ? round2(Math.max(0, base) / monthsUsed) : 0,
    source: (tagged ? "essential_categories" : "all_spending") as EmergencyFundStatus["essentialSource"],
    monthsUsed,
  };
}

export async function getEmergencyFund(userId: string): Promise<EmergencyFundStatus> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const [essential, goals, { liquidBalance }] = await Promise.all([
    essentialMonthlySpend(userId, today, settings),
    prisma.savingsGoal.findMany({ where: { userId, kind: "EMERGENCY_FUND", archivedAt: null }, select: { currentAmount: true } }),
    liquidAccounts(userId),
  ]);
  const fundSource = goals.length ? "emergency_goals" : "liquid_balance";
  const fund = goals.length ? fromMinor(goals.reduce((s, g) => s + toMinor(g.currentAmount.toString()), 0)) : liquidBalance;
  const targetAmount = round2(essential.monthly * settings.emergencyFundMonths);
  return {
    essentialMonthly: essential.monthly,
    essentialSource: essential.source,
    monthsUsed: essential.monthsUsed,
    fund,
    fundSource,
    monthsCovered: essential.monthly > 0 ? round2(fund / essential.monthly) : null,
    targetMonths: settings.emergencyFundMonths,
    targetAmount,
    shortfall: fromMinor(Math.max(0, toMinor(targetAmount) - toMinor(fund))),
    assumptions: [
      essential.source === "essential_categories"
        ? "Essential spending = net spending in categories marked Essential."
        : "No categories are marked Essential yet, so all spending is used. Mark categories as Essential in Settings for a sharper number.",
      `Averaged over the last ${essential.monthsUsed || 0} complete month(s) with activity.`,
      fundSource === "emergency_goals" ? "Fund = money saved in your emergency-fund goals." : "Fund = your current liquid balance (no emergency-fund goal yet).",
    ],
  };
}

// ---------------------------------------------------------------------------
// What-if simulator
// ---------------------------------------------------------------------------

export interface WhatIfInput {
  oneTimeExpense?: number | null;
  oneTimeExpenseLabel?: string | null;
  monthlyExpenseChange?: number | null;
  monthlyIncomeChange?: number | null;
  monthlySavingsIncrease?: number | null;
  months: number;
}

export interface WhatIfResult {
  baseline: { avgIncome: number; avgSpending: number; avgSurplus: number; monthsOfData: number };
  scenario: { monthlySurplus: number; oneTime: number; monthlyToGoals: number };
  series: { month: number; date: ISODate; baseline: number; scenario: number }[];
  startLiquid: number;
  endBaseline: number;
  endScenario: number;
  difference: number;
  firstNegativeMonth: number | null;
  emergencyMonthsAfter: number | null;
  assumptions: string[];
}

/**
 * Deterministic scenario model: starts from today's liquid balance and adds the
 * average monthly surplus of the last 3 complete months (baseline) or the
 * adjusted surplus (scenario). Money moved to goals leaves liquid cash but
 * stays yours — it's reported separately.
 */
export async function simulateWhatIf(userId: string, input: WhatIfInput): Promise<WhatIfResult> {
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const current = financialMonthOf(today, settings.monthStartDay);
  const history = trailingFinancialMonths(addDays(current.start, -1), 3, settings.monthStartDay);
  const [totals, { liquidBalance }, essential] = await Promise.all([
    totalsForWindows(userId, history.map((range, i) => ({ key: String(i), range }))),
    liquidAccounts(userId),
    essentialMonthlySpend(userId, today, settings),
  ]);
  const months = history.map((_, i) => totals.get(String(i))!).filter((t) => t.transactionCount > 0);
  const n = months.length;
  const avgIncome = n ? round2(months.reduce((s, t) => s + t.income, 0) / n) : 0;
  const avgSpending = n ? round2(months.reduce((s, t) => s + t.netSpending, 0) / n) : 0;
  const baseSurplus = toMinor(avgIncome) - toMinor(avgSpending);
  const oneTime = toMinor(input.oneTimeExpense ?? 0);
  const toGoals = toMinor(input.monthlySavingsIncrease ?? 0);
  const scenarioSurplus = baseSurplus + toMinor(input.monthlyIncomeChange ?? 0) - toMinor(input.monthlyExpenseChange ?? 0) - toGoals;
  const series: WhatIfResult["series"] = [];
  let firstNegativeMonth: number | null = null;
  const start = toMinor(liquidBalance);
  for (let m = 0; m <= input.months; m++) {
    const baseline = start + baseSurplus * m;
    const scenario = start - oneTime + scenarioSurplus * m;
    if (scenario < 0 && firstNegativeMonth == null) firstNegativeMonth = m;
    series.push({ month: m, date: addMonthsClamped(today, m), baseline: fromMinor(baseline), scenario: fromMinor(scenario) });
  }
  const last = series[series.length - 1];
  const afterOneTime = fromMinor(start - oneTime);
  return {
    baseline: { avgIncome, avgSpending, avgSurplus: fromMinor(baseSurplus), monthsOfData: n },
    scenario: { monthlySurplus: fromMinor(scenarioSurplus), oneTime: fromMinor(oneTime), monthlyToGoals: fromMinor(toGoals) },
    series,
    startLiquid: liquidBalance,
    endBaseline: last.baseline,
    endScenario: last.scenario,
    difference: fromMinor(toMinor(last.scenario) - toMinor(last.baseline)),
    firstNegativeMonth,
    emergencyMonthsAfter: essential.monthly > 0 ? round2(afterOneTime / essential.monthly) : null,
    assumptions: [
      `Baseline uses your average income and net spending over the last ${n} complete month(s).`,
      "Starts from today's liquid balance (bank, savings, cash, wallets).",
      "Money moved to goals is subtracted from liquid cash but is still yours.",
      "Changes apply from next month onward at a constant rate; no interest or inflation is modelled.",
    ],
  };
}
