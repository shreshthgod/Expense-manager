import { describe, it, expect } from "vitest";
import { call, idem, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as statementRoute from "@/app/api/accounts/[id]/statement/route";
import * as historyRoute from "@/app/api/accounts/[id]/history/route";
import * as txRoute from "@/app/api/transactions/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as budgetsRoute from "@/app/api/budgets/route";
import * as templatesRoute from "@/app/api/budgets/templates/route";
import * as templateApplyRoute from "@/app/api/budgets/templates/[id]/apply/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalIdRoute from "@/app/api/goals/[id]/route";
import * as contributionsRoute from "@/app/api/goals/[id]/contributions/route";
import * as contributionIdRoute from "@/app/api/goals/[id]/contributions/[contributionId]/route";
import * as safeRoute from "@/app/api/planning/safe-to-spend/route";
import * as cashFlowRoute from "@/app/api/planning/cash-flow/route";
import * as emergencyRoute from "@/app/api/planning/emergency-fund/route";
import * as whatIfRoute from "@/app/api/planning/what-if/route";
import * as netWorthRoute from "@/app/api/net-worth/route";
import * as reviewRoute from "@/app/api/review/route";
import * as backupRoute from "@/app/api/backup/route";
import * as restoreRoute from "@/app/api/backup/restore/route";
import * as summaryRoute from "@/app/api/analytics/summary/route";
import * as structureRoute from "@/app/api/analytics/structure/route";
import * as explainRoute from "@/app/api/ai/explain-month/route";
import { verifyLedger } from "@/server/services/account.service";
import { verifyGoalLedger } from "@/server/services/goal.service";
import { addDays, addMonthsClamped, financialMonthOf, parseISODate, todayISO } from "@/lib/dates/date-only";

const today = todayISO("Asia/Kolkata");
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = financialMonthOf(today, 1).end;

async function setup(name: string, accounts: [string, string, number][] = [["Bank", "BANK", 50000], ["Savings", "SAVINGS", 10000]]) {
  const a = await newActor(name);
  const ids: Record<string, string> = {};
  for (const [n, type, opening] of accounts) {
    const res = await call(accountsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: n, type, openingBalance: opening, openingDate: addMonthsClamped(monthStart, -4, 1) },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids[n] = res.body.data.id;
  }
  const cats = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data as { id: string; name: string }[];
  return { a, ids, cat: (n: string) => cats.find((c) => c.name === n)!.id };
}

async function expense(a: Actor, accountId: string, categoryId: string, amount: number, date: string) {
  const res = await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount, transactionDate: date, accountId, categoryId } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data;
}

async function balance(a: Actor, name: string) {
  const res = await call(accountsRoute.GET, "GET", "/x", { as: a });
  return res.body.data.accounts.find((x: { name: string }) => x.name === name).balance as number;
}

describe("budget rollover", () => {
  it("carries unused money (POSITIVE_ONLY) or the full result (FULL) into the current cycle", async () => {
    const { a, ids, cat } = await setup("Rollover");
    const m2 = addMonthsClamped(monthStart, -2, 1);
    const m1 = addMonthsClamped(monthStart, -1, 1);
    await expense(a, ids.Bank, cat("Food"), 4000, addDays(m2, 4)); // cycle -2: 3000 − 4000 = −1000
    await expense(a, ids.Bank, cat("Food"), 1000, addDays(m1, 4)); // cycle -1: 3000 − 1000
    await expense(a, ids.Bank, cat("Food"), 500, today);

    const positive = await call(budgetsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Food", amount: 3000, period: "MONTHLY", startDate: m2, categoryId: cat("Food"), rolloverMode: "POSITIVE_ONLY" },
    });
    expect(positive.status, JSON.stringify(positive.body)).toBe(201);
    // POSITIVE_ONLY: max(0, −1000) = 0 → 0 + 3000 − 1000 = 2000 carried in.
    expect(positive.body.data).toMatchObject({ carryIn: 2000, available: 5000, spent: 500, remaining: 4500, rolloverMode: "POSITIVE_ONLY" });

    const full = await call(budgetsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "All", amount: 3000, period: "MONTHLY", startDate: m2, categoryId: null, rolloverMode: "FULL" },
    });
    // FULL: −1000 → −1000 + 3000 − 1000 = 1000 carried in.
    expect(full.body.data).toMatchObject({ carryIn: 1000, available: 4000, spent: 500 });

    const none = await call(budgetsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Weekly-less", amount: 3000, period: "YEARLY", startDate: m2, categoryId: cat("Food") },
    });
    expect(none.body.data).toMatchObject({ carryIn: 0, available: 3000 });
  });
});

describe("goal contribution ledger", () => {
  it("earmarks, transfers, releases and keeps currentAmount = Σ contributions", async () => {
    const { a, ids } = await setup("Goals");
    const goal = await call(goalsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Trip", targetAmount: 20000, currentAmount: 1000, accountId: ids.Savings, monthlyContribution: 3000 },
    });
    expect(goal.status, JSON.stringify(goal.body)).toBe(201);
    const id = goal.body.data.id;
    expect(goal.body.data).toMatchObject({ currentAmount: 1000, pace: 3000, paceSource: "planned", accountName: "Savings" });
    expect(goal.body.data.expectedCompletion).toBe(addMonthsClamped(today, 7)); // ceil(19000 / 3000) = 7

    // Transfer mode moves real money and links the transfer.
    const t = await call(contributionsRoute.POST, "POST", "/x", {
      as: a,
      params: { id },
      headers: idem(),
      body: { amount: 5000, mode: "transfer", fromAccountId: ids.Bank, toAccountId: ids.Savings },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.data.currentAmount).toBe(6000);
    expect(t.body.data.transactionId).toBeTruthy();
    expect(await balance(a, "Bank")).toBe(45000);
    expect(await balance(a, "Savings")).toBe(15000);

    // Earmark release moves no money.
    const release = await call(contributionsRoute.POST, "POST", "/x", { as: a, params: { id }, body: { amount: -2000 } });
    expect(release.body.data.currentAmount).toBe(4000);
    expect(await balance(a, "Bank")).toBe(45000);

    const tooMuch = await call(contributionsRoute.POST, "POST", "/x", { as: a, params: { id }, body: { amount: -4000.01 } });
    expect(tooMuch.status).toBe(400);

    const future = await call(contributionsRoute.POST, "POST", "/x", { as: a, params: { id }, body: { amount: 10, date: addDays(today, 3) } });
    expect(future.status).toBe(400);

    const list = await call(contributionsRoute.GET, "GET", "/x", { as: a, params: { id } });
    expect(list.body.data).toHaveLength(3);
    const linked = list.body.data.find((c: { transactionId: string | null }) => c.transactionId);
    const releaseRow = list.body.data.find((c: { amount: number }) => c.amount === -2000);
    // Removing the +5000 entry first would leave −1000 saved: refused.
    const negative = await call(contributionIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id, contributionId: linked.id } });
    expect(negative.status).toBe(422);
    expect(negative.body.error?.code).toBe("GOAL_NEGATIVE");
    await call(contributionIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id, contributionId: releaseRow.id } });
    const removed = await call(contributionIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id, contributionId: linked.id } });
    expect(removed.status).toBe(200);
    expect(removed.body.data.currentAmount).toBe(1000);
    expect(removed.body.data.warnings[0]).toMatch(/linked transfer was kept/);
    expect(await balance(a, "Savings")).toBe(15000); // transfer untouched

    // Target change completes the goal; editing clears nothing else.
    const g = (await call(goalsRoute.GET, "GET", "/x", { as: a })).body.data.find((x: { id: string }) => x.id === id);
    const upd = await call(goalIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id }, body: { version: g.version, targetAmount: g.currentAmount || 1 } });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(await verifyGoalLedger(a.userId)).toEqual([]);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});

describe("budget templates", () => {
  it("saves current budgets, previews conflicts and replaces only with consent", async () => {
    const { a, cat } = await setup("Templates");
    const created = await call(budgetsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Groceries", amount: 8000, period: "MONTHLY", startDate: addMonthsClamped(monthStart, -1, 1), categoryId: cat("Groceries") },
    });
    expect(created.status).toBe(201);
    const tpl = await call(templatesRoute.POST, "POST", "/x", { as: a, body: { fromCurrent: true, name: "Base" } });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    expect(tpl.body.data.items).toHaveLength(1);

    const nextMonth = addMonthsClamped(monthStart, 1, 1);
    const preview = await call(templateApplyRoute.POST, "POST", "/x", { as: a, params: { id: tpl.body.data.id }, body: { startDate: nextMonth, dryRun: true } });
    expect(preview.body.data).toMatchObject({ applied: false, created: 0, skipped: 1 });

    const apply = await call(templateApplyRoute.POST, "POST", "/x", {
      as: a,
      params: { id: tpl.body.data.id },
      body: { startDate: nextMonth, replaceConflicts: true, dryRun: false },
    });
    expect(apply.status, JSON.stringify(apply.body)).toBe(200);
    expect(apply.body.data).toMatchObject({ applied: true, replaced: 1 });
    const budgets = (await call(budgetsRoute.GET, "GET", "/x", { as: a })).body.data as { name: string; startDate: string; endDate: string | null }[];
    expect(budgets).toHaveLength(2);
    expect(budgets.find((b) => b.startDate !== nextMonth)!.endDate).toBe(addDays(nextMonth, -1));
  });
});

describe("safe to spend, cash flow, emergency fund, what-if, net worth", () => {
  it("computes every figure from recorded data with no double counting", async () => {
    const { a, ids, cat } = await setup("Planning");
    await expense(a, ids.Bank, cat("Rent"), 15000, addMonthsClamped(monthStart, -1, 1));
    const inTen = addDays(today, 10);
    const inFive = addDays(today, 5);
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 2000, transactionDate: inTen, accountId: ids.Bank, categoryId: cat("Utilities") } });
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "INCOME", amount: 10000, transactionDate: inFive, accountId: ids.Bank, categoryId: cat("Salary") } });
    const goal = await call(goalsRoute.POST, "POST", "/x", { as: a, body: { name: "Fund", targetAmount: 50000, monthlyContribution: 3000 } });
    await call(contributionsRoute.POST, "POST", "/x", { as: a, params: { id: goal.body.data.id }, body: { amount: 1000 } });

    const liquid = 50000 - 15000 + 10000; // Bank + Savings
    const flow = await call(cashFlowRoute.GET, "GET", "/x", { as: a, query: { days: 30 } });
    expect(flow.status, JSON.stringify(flow.body)).toBe(200);
    expect(flow.body.data.startingLiquid).toBe(liquid);
    expect(flow.body.data.endingBalance).toBe(liquid + 10000 - 2000);
    expect(flow.body.data.items.filter((i: { source: string }) => i.source === "planned")).toHaveLength(2);
    const noIncome = await call(cashFlowRoute.GET, "GET", "/x", { as: a, query: { days: 30, includeExpectedIncome: false } });
    expect(noIncome.body.data.endingBalance).toBe(liquid - 2000);

    const safe = (await call(safeRoute.GET, "GET", "/x", { as: a })).body.data;
    const commitments = inTen < monthEnd ? 2000 : 0;
    const income = inFive < monthEnd ? 10000 : 0;
    expect(safe).toMatchObject({ liquid, commitments, goalPlans: 2000, expectedIncome: income });
    expect(safe.safeToSpend).toBe(liquid - commitments - 2000);
    expect(safe.safeToSpendWithIncome).toBe(liquid - commitments - 2000 + income);

    const ef = (await call(emergencyRoute.GET, "GET", "/x", { as: a })).body.data;
    expect(ef.essentialSource).toBe("essential_categories");
    expect(ef.essentialMonthly).toBe(15000); // Rent is essential; one active month
    expect(ef.fundSource).toBe("liquid_balance");

    const wi = (await call(whatIfRoute.POST, "POST", "/x", { as: a, body: { oneTimeExpense: 10000, months: 6 } })).body.data;
    expect(wi.difference).toBe(-10000);
    expect(wi.startLiquid).toBe(liquid);
    const wi2 = (await call(whatIfRoute.POST, "POST", "/x", { as: a, body: { monthlyExpenseChange: 1000, months: 6, explain: true } })).body.data;
    expect(wi2.difference).toBe(-6000);
    expect(wi2.narrative.usedAI).toBe(false);
    expect(wi2.narrative.summary).toMatch(/difference/);

    const nw = (await call(netWorthRoute.GET, "GET", "/x", { as: a, query: { months: 6 } })).body.data;
    expect(nw.points).toHaveLength(6);
    expect(nw.points.at(-1).netWorth).toBe(nw.summary.netWorth);
    expect(nw.points.at(-1).netWorth).toBe(liquid);

    const hist = (await call(historyRoute.GET, "GET", "/x", { as: a, params: { id: ids.Bank }, query: { days: 60 } })).body.data;
    expect(hist).toHaveLength(60);
    expect(hist.at(-1).balance).toBe(await balance(a, "Bank"));

    const structure = (await call(structureRoute.GET, "GET", "/x", { as: a, query: { preset: "last_month" } })).body.data;
    expect(structure.current).toMatchObject({ total: 15000, essential: 15000, fixed: 15000 });
  });
});

describe("credit cards", () => {
  it("reports statement balance, payments since and amount due from recorded data", async () => {
    const { a, ids, cat } = await setup("Card", [["Bank", "BANK", 50000]]);
    const stmtDate = addDays(today, -10);
    const card = await call(accountsRoute.POST, "POST", "/x", {
      as: a,
      body: {
        name: "Card", type: "CREDIT_CARD", openingBalance: 0, openingDate: addDays(today, -60),
        creditLimit: 100000, statementDay: parseISODate(stmtDate).day, paymentDueDay: 28, maskedNumber: "1234",
      },
    });
    expect(card.status, JSON.stringify(card.body)).toBe(201);
    const cardId = card.body.data.id;
    await expense(a, cardId, cat("Shopping"), 5000, addDays(today, -15));
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "TRANSFER", amount: 2000, transactionDate: addDays(today, -2), accountId: ids.Bank, destinationAccountId: cardId } });
    await expense(a, cardId, cat("Shopping"), 1000, addDays(today, -1));

    const st = await call(statementRoute.GET, "GET", "/x", { as: a, params: { id: cardId } });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body.data).toMatchObject({ statementBalance: 5000, paidSinceStatement: 2000, amountDue: 3000, outstandingNow: 4000 });
    const dto = (await call(accountsRoute.GET, "GET", "/x", { as: a })).body.data.accounts.find((x: { id: string }) => x.id === cardId);
    expect(dto.card).toMatchObject({ creditLimit: 100000, availableCredit: 96000, utilization: 4, maskedNumber: "1234" });
    const notCard = await call(statementRoute.GET, "GET", "/x", { as: a, params: { id: ids.Bank } });
    expect(notCard.status).toBe(422);
  });
});

describe("monthly review", () => {
  it("summarises a month, stores a snapshot and flags later back-dated changes", async () => {
    const { a, ids, cat } = await setup("Review");
    const last = addMonthsClamped(monthStart, -1, 1);
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "INCOME", amount: 40000, transactionDate: addDays(last, 1), accountId: ids.Bank, categoryId: cat("Salary") } });
    await expense(a, ids.Bank, cat("Groceries"), 6000, addDays(last, 3));
    const r = await call(reviewRoute.GET, "GET", "/x", { as: a });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.period.start).toBe(last);
    expect(r.body.data.totals).toMatchObject({ income: 40000, netSpending: 6000, surplus: 34000 });
    expect(r.body.data.snapshot).toBeNull();

    const marked = await call(reviewRoute.POST, "POST", "/x", { as: a, body: { periodStart: last, notes: "Good month" } });
    expect(marked.body.data.snapshot).toMatchObject({ notes: "Good month", changedSinceReview: false });
    expect(marked.body.data.snapshot.reviewedAt).toBeTruthy();

    await expense(a, ids.Bank, cat("Groceries"), 500, addDays(last, 5));
    const again = await call(reviewRoute.GET, "GET", "/x", { as: a, query: { periodStart: last } });
    expect(again.body.data.snapshot.changedSinceReview).toBe(true);

    const explained = await call(explainRoute.GET, "GET", "/x", { as: a, query: { periodStart: last } });
    expect(explained.status).toBe(200);
    expect(explained.body.data.usedAI).toBe(false);
    expect(explained.body.data.basis).toMatchObject({ income: 40000, netSpending: 6500 });
  });
});

describe("backup and restore", () => {
  it("round-trips a user's data into another account with identical balances and totals", async () => {
    const { a, ids, cat } = await setup("Backup source");
    const e = await expense(a, ids.Bank, cat("Groceries"), 3000, today);
    await call((await import("@/app/api/transactions/[id]/refunds/route")).POST, "POST", "/x", {
      as: a, params: { id: e.id }, headers: idem(), body: { amount: 500, transactionDate: today, accountId: ids.Bank },
    });
    await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 1000, transactionDate: today, accountId: ids.Savings, splits: [{ categoryId: cat("Food"), amount: 600 }, { categoryId: cat("Shopping"), amount: 400 }] },
    });
    const goal = await call(goalsRoute.POST, "POST", "/x", { as: a, body: { name: "G", targetAmount: 5000, currentAmount: 700 } });
    expect(goal.status).toBe(201);

    const exported = await call(backupRoute.GET, "GET", "/x", { as: a });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/);
    const file = exported.body as unknown as { format: string; data: Record<string, unknown[]> };
    expect(file.format).toBe("expense-manager-backup");
    expect(file.data.transactions).toHaveLength(3);
    expect(JSON.stringify(file)).not.toMatch(/passwordHash/);

    const b = await newActor("Backup target");
    const dry = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "replace", dryRun: true, file } });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data.problems).toEqual([]);
    const noConfirm = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "replace", dryRun: false, file } });
    expect(noConfirm.status).toBe(400);
    const restored = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "replace", dryRun: false, confirm: "REPLACE", file } });
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
    expect(restored.body.data.ledgerOk).toBe(true);

    const sumA = (await call(summaryRoute.GET, "GET", "/x", { as: a, query: { preset: "this_month" } })).body.data.current;
    const sumB = (await call(summaryRoute.GET, "GET", "/x", { as: b, query: { preset: "this_month" } })).body.data.current;
    expect(sumB).toEqual(sumA);
    expect(await balance(b, "Bank")).toBe(await balance(a, "Bank"));
    expect(await balance(b, "Savings")).toBe(await balance(a, "Savings"));
    const goalsB = (await call(goalsRoute.GET, "GET", "/x", { as: b })).body.data;
    expect(goalsB[0].currentAmount).toBe(700);

    // Merging the same file again matches categories by name and keeps the ledger valid.
    const merged = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "merge", dryRun: false, file } });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.data.skipped.categories).toBeGreaterThan(0);
    expect(merged.body.data.ledgerOk).toBe(true);
    expect(await verifyLedger(b.userId)).toEqual([]);

    // Tampered references are rejected before anything is written.
    const broken = JSON.parse(JSON.stringify(file));
    (broken.data.transactions[0] as { accountId: string }).accountId = "missing";
    const bad = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "merge", dryRun: false, file: broken } });
    expect(bad.status).toBe(400);
    const wrong = await call(restoreRoute.POST, "POST", "/x", { as: b, body: { mode: "merge", dryRun: true, file: { format: "other" } } });
    expect(wrong.status).toBe(400);
  });
});
