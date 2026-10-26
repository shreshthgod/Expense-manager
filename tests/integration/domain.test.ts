import { describe, it, expect } from "vitest";
import { call, idem, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as txRoute from "@/app/api/transactions/route";
import * as txIdRoute from "@/app/api/transactions/[id]/route";
import * as refundRoute from "@/app/api/transactions/[id]/refunds/route";
import * as restoreRoute from "@/app/api/transactions/[id]/restore/route";
import * as bulkRoute from "@/app/api/transactions/bulk/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as budgetsRoute from "@/app/api/budgets/route";
import * as summaryRoute from "@/app/api/analytics/summary/route";
import * as catAnalyticsRoute from "@/app/api/analytics/categories/route";
import * as merchantsRoute from "@/app/api/merchants/route";
import * as rulesRoute from "@/app/api/rules/route";
import * as ruleApplyRoute from "@/app/api/rules/[id]/apply/route";
import * as suggestRoute from "@/app/api/rules/suggest/route";
import { verifyLedger } from "@/server/services/account.service";
import { todayISO } from "@/lib/dates/date-only";

const today = todayISO("Asia/Kolkata");
const monthStart = `${today.slice(0, 7)}-01`;

async function setup(name: string, accounts: [string, string, number][] = [["Bank", "BANK", 50000], ["Cash", "CASH", 5000]]) {
  const a = await newActor(name);
  const ids: Record<string, string> = {};
  for (const [n, type, opening] of accounts) {
    ids[n] = (await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: n, type, openingBalance: opening } })).body.data.id;
  }
  const cats = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data as { id: string; name: string }[];
  return { a, ids, cat: (n: string) => cats.find((c) => c.name === n)!.id };
}

async function balances(a: Actor) {
  const res = await call(accountsRoute.GET, "GET", "/x", { as: a, query: { includeArchived: true } });
  return {
    byName: Object.fromEntries(res.body.data.accounts.map((x: { name: string; balance: number }) => [x.name, x.balance])) as Record<string, number>,
    total: res.body.data.summary.totalAssets as number,
  };
}

async function totals(a: Actor) {
  return (await call(summaryRoute.GET, "GET", "/x", { as: a, query: { preset: "this_month" } })).body.data.current as {
    income: number;
    grossExpense: number;
    refunds: number;
    netSpending: number;
  };
}

async function budgetSpent(a: Actor, id: string) {
  const res = await call(budgetsRoute.GET, "GET", "/x", { as: a });
  return res.body.data.find((b: { id: string }) => b.id === id).spent as number;
}

describe("Scenario A (complete) — lifecycle including a linked refund", () => {
  it("reconciles balances, net spending and budget at every step", async () => {
    const { a, ids, cat } = await setup("Scenario A full");
    const budget = (
      await call(budgetsRoute.POST, "POST", "/x", { as: a, body: { name: "Groceries", amount: 3000, period: "MONTHLY", startDate: monthStart, categoryId: cat("Groceries") } })
    ).body.data.id;

    const expense = (await call(txRoute.POST, "POST", "/x", { as: a, headers: idem(), body: { type: "EXPENSE", amount: 2000, transactionDate: today, accountId: ids.Bank, categoryId: cat("Groceries") } })).body.data;
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "INCOME", amount: 10000, transactionDate: today, accountId: ids.Bank, categoryId: cat("Salary") } });
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "TRANSFER", amount: 3000, transactionDate: today, accountId: ids.Bank, destinationAccountId: ids.Cash } });
    let b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 55000, Cash: 8000 });
    expect(b.total).toBe(63000);

    // Linked refund ₹500 to Bank.
    const refund = await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: expense.id }, headers: idem(), body: { amount: 500, transactionDate: today, accountId: ids.Bank } });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 55500, Cash: 8000 });
    expect(b.total).toBe(63500);
    expect(await totals(a)).toMatchObject({ income: 10000, grossExpense: 2000, refunds: 500, netSpending: 1500 });
    expect(await budgetSpent(a, budget)).toBe(1500);

    // Edit original expense to 2,500.
    const current = (await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: expense.id } })).body.data;
    expect(current.refundedAmount).toBe(500);
    const edited = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: expense.id }, body: { version: current.version, amount: 2500 } });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    b = await balances(a);
    expect(b.byName.Bank).toBe(55000);
    expect(b.total).toBe(63000);
    expect((await totals(a)).netSpending).toBe(2000);
    expect(await budgetSpent(a, budget)).toBe(2000);

    // The purchase can't be edited below what was refunded.
    const tooLow = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: expense.id }, body: { version: edited.body.data.version, amount: 400 } });
    expect(tooLow.status).toBe(400);

    // Deleting the purchase is blocked while the refund exists.
    const blocked = await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: expense.id } });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.code).toBe("REFUNDS_EXIST");

    // Delete refund.
    await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: refund.body.data.id } });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 54500, Cash: 8000 });
    expect(b.total).toBe(62500);
    expect((await totals(a)).netSpending).toBe(2500);
    expect(await budgetSpent(a, budget)).toBe(2500);

    // Delete original expense.
    await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: expense.id } });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 57000, Cash: 8000 });
    expect(b.total).toBe(65000);
    expect((await totals(a)).netSpending).toBe(0);
    expect(await budgetSpent(a, budget)).toBe(0);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });

  it("caps cumulative refunds and restores a purchase + refunds only in dependency order", async () => {
    const { a, ids, cat } = await setup("Refund caps");
    const exp = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 1000, transactionDate: today, accountId: ids.Bank, categoryId: cat("Shopping") } })).body.data;
    expect((await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: exp.id }, body: { amount: 700, transactionDate: today, accountId: ids.Bank } })).status).toBe(201);
    const over = await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: exp.id }, body: { amount: 301, transactionDate: today, accountId: ids.Bank } });
    expect(over.status).toBe(400);
    expect(over.body.error?.details?.[0]?.path).toEqual(["amount"]);
    // Explicit dependency resolution deletes both atomically.
    const both = await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: exp.id }, query: { withRefunds: "true" } });
    expect(both.status).toBe(200);
    expect(both.body.data.deletedRefundIds).toHaveLength(1);
    expect((await balances(a)).byName.Bank).toBe(50000);
    // A refund can't come back before its purchase.
    const early = await call(restoreRoute.POST, "POST", "/x", { as: a, params: { id: both.body.data.deletedRefundIds[0] } });
    expect(early.status).toBe(422);
    expect((await call(restoreRoute.POST, "POST", "/x", { as: a, params: { id: exp.id } })).status).toBe(200);
    expect((await call(restoreRoute.POST, "POST", "/x", { as: a, params: { id: both.body.data.deletedRefundIds[0] } })).status).toBe(200);
    expect((await balances(a)).byName.Bank).toBe(49700); // −1,000 purchase + 700 refund
    expect(await verifyLedger(a.userId)).toEqual([]);
  });

  it("a card refund reduces the card's debt", async () => {
    const { a, ids, cat } = await setup("Card refund", [["Card", "CREDIT_CARD", 0]]);
    const exp = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 4000, transactionDate: today, accountId: ids.Card, categoryId: cat("Shopping") } })).body.data;
    await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: exp.id }, body: { amount: 1500, transactionDate: today, accountId: ids.Card } });
    expect((await balances(a)).byName.Card).toBe(-2500);
  });
});

describe("Scenario D — split purchase", () => {
  it("debits once and allocates each category exactly (budgets never double count)", async () => {
    const { a, ids, cat } = await setup("Scenario D");
    const food = (await call(budgetsRoute.POST, "POST", "/x", { as: a, body: { name: "Food", amount: 10000, period: "MONTHLY", startDate: monthStart, categoryId: cat("Food") } })).body.data.id;
    const household = (await call(budgetsRoute.POST, "POST", "/x", { as: a, body: { name: "Household", amount: 10000, period: "MONTHLY", startDate: monthStart, categoryId: cat("Household") } })).body.data.id;
    const overall = (await call(budgetsRoute.POST, "POST", "/x", { as: a, body: { name: "All", amount: 50000, period: "MONTHLY", startDate: monthStart } })).body.data.id;

    const bad = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 4500, transactionDate: today, accountId: ids.Bank, splits: [{ categoryId: cat("Groceries"), amount: 3000 }, { categoryId: cat("Household"), amount: 900 }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error?.details?.[0]?.path).toEqual(["splits"]);

    const split = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: {
        type: "EXPENSE",
        amount: 4500,
        transactionDate: today,
        accountId: ids.Bank,
        merchant: "DMart",
        splits: [
          { categoryId: cat("Food"), amount: 3000 },
          { categoryId: cat("Household"), amount: 900 },
          { categoryId: cat("Personal Care"), amount: 600, note: "Soap" },
        ],
      },
    });
    expect(split.status, JSON.stringify(split.body)).toBe(201);
    expect(split.body.data.isSplit).toBe(true);
    expect(split.body.data.categoryId).toBeNull();
    expect((await balances(a)).byName.Bank).toBe(45500);
    expect(await budgetSpent(a, food)).toBe(3000);
    expect(await budgetSpent(a, household)).toBe(900);
    expect(await budgetSpent(a, overall)).toBe(4500);

    const byCategory = (await call(catAnalyticsRoute.GET, "GET", "/x", { as: a, query: { preset: "this_month" } })).body.data.items as { name: string; total: number }[];
    expect(byCategory.find((c) => c.name === "Food")?.total).toBe(3000);
    expect(byCategory.find((c) => c.name === "Personal Care")?.total).toBe(600);
    expect(byCategory.reduce((s, c) => s + c.total, 0)).toBe(4500);

    // Filtering by a split's category finds the purchase.
    const filtered = await call(txRoute.GET, "GET", "/x", { as: a, query: { categoryId: cat("Household") } });
    expect(filtered.body.data.items.map((t: { id: string }) => t.id)).toContain(split.body.data.id);

    // A refund of one allocation is capped by that allocation.
    const refund = await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: split.body.data.id }, body: { amount: 950, transactionDate: today, accountId: ids.Bank, categoryId: cat("Household") } });
    expect(refund.status).toBe(400);
    const ok = await call(refundRoute.POST, "POST", "/x", { as: a, params: { id: split.body.data.id }, body: { amount: 900, transactionDate: today, accountId: ids.Bank, categoryId: cat("Household") } });
    expect(ok.status).toBe(201);
    expect(await budgetSpent(a, household)).toBe(0);
    expect(await budgetSpent(a, food)).toBe(3000);

    // Removing splits requires a category again.
    const cur = (await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: split.body.data.id } })).body.data;
    const unsplit = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: cur.id }, body: { version: cur.version, splits: null, categoryId: cat("Household") } });
    expect(unsplit.status, JSON.stringify(unsplit.body)).toBe(200);
    expect(await budgetSpent(a, household)).toBe(4500 - 900);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});

describe("merchants, rules and bulk actions", () => {
  it("normalises merchants via aliases while keeping the original text", async () => {
    const { a, ids, cat } = await setup("Merchants");
    await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 499, transactionDate: today, accountId: ids.Bank, categoryId: cat("Shopping"), merchant: "AMZN Mktp IN" } });
    const m = await call(merchantsRoute.POST, "POST", "/x", { as: a, body: { name: "Amazon", aliases: ["amzn mktp", "amazon india"] } });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body.data.linked).toBe(1);
    const next = await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 1200, transactionDate: today, accountId: ids.Bank, categoryId: cat("Shopping"), merchant: "Amazon India Pvt" } });
    expect(next.body.data.merchantName).toBe("Amazon");
    expect(next.body.data.merchant).toBe("Amazon India Pvt");
    const list = await call(merchantsRoute.GET, "GET", "/x", { as: a });
    expect(list.body.data[0].stats).toMatchObject({ total: 1699, count: 2 });
  });

  it("rules suggest deterministically and apply only after preview", async () => {
    const { a, ids, cat } = await setup("Rules");
    const uncategorized = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 250, transactionDate: today, accountId: ids.Bank, categoryId: cat("Other"), merchant: "Uber trip" },
    });
    // make it uncategorised via prisma-free path: rules apply to "all" scope only when chosen explicitly
    const rule = await call(rulesRoute.POST, "POST", "/x", { as: a, body: { name: "Uber is transport", matchMerchant: "uber", setCategoryId: cat("Transport"), addTags: ["Commute"] } });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const suggestion = await call(suggestRoute.GET, "GET", "/x", { as: a, query: { merchant: "UBER *TRIP", type: "EXPENSE" } });
    expect(suggestion.body.data).toMatchObject({ categoryId: cat("Transport"), source: { kind: "rule" } });
    const preview = await call(ruleApplyRoute.POST, "POST", "/x", { as: a, params: { id: rule.body.data.id }, body: { scope: "all", dryRun: true } });
    expect(preview.body.data).toMatchObject({ matched: 1, willChange: 1, applied: 0 });
    const tx = (await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: uncategorized.body.data.id } })).body.data;
    expect(tx.category.name).toBe("Other");
    const applied = await call(ruleApplyRoute.POST, "POST", "/x", { as: a, params: { id: rule.body.data.id }, body: { scope: "all", dryRun: false } });
    expect(applied.body.data.applied).toBe(1);
    const after = (await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: uncategorized.body.data.id } })).body.data;
    expect(after.category.name).toBe("Transport");
    expect(after.tags).toContain("Commute");
    // Merchant history suggests next time even without a rule.
    const hist = await call(suggestRoute.GET, "GET", "/x", { as: a, query: { merchant: "Uber trip", type: "EXPENSE" } });
    expect(hist.body.data.categoryId).toBe(cat("Transport"));
  });

  it("bulk actions preview, skip ineligible rows with reasons, and never move one side of a transfer", async () => {
    const { a, ids, cat } = await setup("Bulk");
    const e1 = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 100, transactionDate: today, accountId: ids.Bank, categoryId: cat("Food") } })).body.data;
    const e2 = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: 200, transactionDate: today, accountId: ids.Bank, categoryId: cat("Food") } })).body.data;
    const tr = (await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "TRANSFER", amount: 300, transactionDate: today, accountId: ids.Bank, destinationAccountId: ids.Cash } })).body.data;
    const preview = await call(bulkRoute.POST, "POST", "/x", { as: a, body: { action: "moveAccount", ids: [e1.id, e2.id, tr.id], accountId: ids.Cash, dryRun: true } });
    expect(preview.body.data).toMatchObject({ processed: 2, dryRun: true });
    expect(preview.body.data.skipped).toEqual([{ id: tr.id, reason: expect.stringContaining("Transfers") }]);
    expect((await balances(a)).byName.Bank).toBe(50000 - 600);
    const moved = await call(bulkRoute.POST, "POST", "/x", { as: a, body: { action: "moveAccount", ids: [e1.id, e2.id, tr.id], accountId: ids.Cash } });
    expect(moved.body.data.processed).toBe(2);
    const b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 50000 - 300, Cash: 5000 + 300 - 300 });
    const tagged = await call(bulkRoute.POST, "POST", "/x", { as: a, body: { action: "addTag", ids: [e1.id, e2.id], tag: "Trip" } });
    expect(tagged.body.data.processed).toBe(2);
    const del = await call(bulkRoute.POST, "POST", "/x", { as: a, body: { action: "delete", ids: [e1.id, e2.id] } });
    expect(del.body.data.processed).toBe(2);
    expect((await balances(a)).byName.Cash).toBe(5300);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});
