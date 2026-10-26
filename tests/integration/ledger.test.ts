import { describe, it, expect, beforeAll } from "vitest";
import { call, idem, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as accountRoute from "@/app/api/accounts/[id]/route";
import * as adjustRoute from "@/app/api/accounts/[id]/adjust/route";
import * as txRoute from "@/app/api/transactions/route";
import * as txIdRoute from "@/app/api/transactions/[id]/route";
import * as restoreRoute from "@/app/api/transactions/[id]/restore/route";
import * as postRoute from "@/app/api/transactions/[id]/post/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as budgetsRoute from "@/app/api/budgets/route";
import * as summaryRoute from "@/app/api/analytics/summary/route";
import { verifyLedger } from "@/server/services/account.service";
import { todayISO, addDays } from "@/lib/dates/date-only";

const today = todayISO("Asia/Kolkata");

async function createAccount(a: Actor, name: string, type: string, openingBalance: number) {
  const res = await call(accountsRoute.POST, "POST", "/api/accounts", { as: a, body: { name, type, openingBalance } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; version: number };
}

async function categoryId(a: Actor, name: string) {
  const res = await call(categoriesRoute.GET, "GET", "/api/categories", { as: a });
  const c = res.body.data.find((x: { name: string }) => x.name === name);
  expect(c, `category ${name}`).toBeTruthy();
  return c.id as string;
}

async function balances(a: Actor) {
  const res = await call(accountsRoute.GET, "GET", "/api/accounts", { as: a, query: { includeArchived: true } });
  const byName = Object.fromEntries(res.body.data.accounts.map((x: { name: string; balance: number }) => [x.name, x.balance]));
  return { byName, summary: res.body.data.summary as { liquid: number; totalAssets: number; totalLiabilities: number; netWorth: number } };
}

async function monthTotals(a: Actor) {
  const res = await call(summaryRoute.GET, "GET", "/api/analytics/summary", { as: a, query: { preset: "this_month" } });
  return res.body.data.current as { income: number; netSpending: number; grossExpense: number };
}

async function createTx(a: Actor, body: Record<string, unknown>) {
  const res = await call(txRoute.POST, "POST", "/api/transactions", { as: a, body, headers: idem() });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; version: number; status: string };
}

describe("Scenario A — connected transaction lifecycle", () => {
  let a: Actor;
  let bank: string;
  let cash: string;
  let groceries: string;
  let salary: string;
  let budgetId: string;

  beforeAll(async () => {
    a = await newActor("Scenario A");
    bank = (await createAccount(a, "Bank", "BANK", 50000)).id;
    cash = (await createAccount(a, "Cash", "CASH", 5000)).id;
    groceries = await categoryId(a, "Groceries");
    salary = await categoryId(a, "Salary");
    const b = await call(budgetsRoute.POST, "POST", "/api/budgets", {
      as: a,
      body: { name: "Groceries", amount: 3000, period: "MONTHLY", startDate: `${today.slice(0, 7)}-01`, categoryId: groceries },
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    budgetId = b.body.data.id;
  });

  async function budgetSpent() {
    const res = await call(budgetsRoute.GET, "GET", "/api/budgets", { as: a });
    return res.body.data.find((x: { id: string }) => x.id === budgetId).spent as number;
  }

  it("keeps balances, totals, budget and ledger in agreement at every step", async () => {
    let b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 50000, Cash: 5000 });
    expect(b.summary.totalAssets).toBe(55000);

    const expense = await createTx(a, { type: "EXPENSE", amount: 2000, transactionDate: today, accountId: bank, categoryId: groceries });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 48000, Cash: 5000 });
    expect(b.summary.totalAssets).toBe(53000);
    expect(await monthTotals(a)).toMatchObject({ income: 0, netSpending: 2000 });
    expect(await budgetSpent()).toBe(2000);

    await createTx(a, { type: "INCOME", amount: 10000, transactionDate: today, accountId: bank, categoryId: salary });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 58000, Cash: 5000 });
    expect(b.summary.totalAssets).toBe(63000);

    const transfer = await createTx(a, { type: "TRANSFER", amount: 3000, transactionDate: today, accountId: bank, destinationAccountId: cash });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 55000, Cash: 8000 });
    expect(b.summary.totalAssets).toBe(63000);
    expect(await monthTotals(a)).toMatchObject({ income: 10000, netSpending: 2000 });
    expect(await budgetSpent()).toBe(2000);

    // Edit the original expense to 2,500.
    const edit = await call(txIdRoute.PATCH, "PATCH", `/api/transactions/${expense.id}`, {
      as: a,
      params: { id: expense.id },
      body: { version: expense.version, amount: 2500 },
    });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 54500, Cash: 8000 });
    expect(await budgetSpent()).toBe(2500);

    // Delete the original expense → effects fully reversed.
    const del = await call(txIdRoute.DELETE, "DELETE", `/api/transactions/${expense.id}`, { as: a, params: { id: expense.id } });
    expect(del.status).toBe(200);
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 57000, Cash: 8000 });
    expect(b.summary.totalAssets).toBe(65000);
    expect(await monthTotals(a)).toMatchObject({ income: 10000, netSpending: 0 });
    expect(await budgetSpent()).toBe(0);

    // Undo restores the complete financial state.
    const restore = await call(restoreRoute.POST, "POST", `/api/transactions/${expense.id}/restore`, { as: a, params: { id: expense.id } });
    expect(restore.status).toBe(200);
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 54500, Cash: 8000 });
    expect(await budgetSpent()).toBe(2500);

    // Editing a transfer reverses the old legs and applies the new ones.
    const t = await call(txIdRoute.GET, "GET", `/api/transactions/${transfer.id}`, { as: a, params: { id: transfer.id } });
    const moved = await call(txIdRoute.PATCH, "PATCH", `/api/transactions/${transfer.id}`, {
      as: a,
      params: { id: transfer.id },
      body: { version: t.body.data.version, amount: 1000, accountId: cash, destinationAccountId: bank },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    b = await balances(a);
    // Original transfer (Bank→Cash 3000) undone: Bank 57500, Cash 5000; new Cash→Bank 1000.
    expect(b.byName).toMatchObject({ Bank: 58500, Cash: 4000 });
    expect(b.summary.totalAssets).toBe(62500);

    expect(await verifyLedger(a.userId)).toEqual([]);
  });

  it("rejects transfers to the same account and transfers without a destination", async () => {
    const same = await call(txRoute.POST, "POST", "/api/transactions", {
      as: a,
      body: { type: "TRANSFER", amount: 10, transactionDate: today, accountId: bank, destinationAccountId: bank },
    });
    expect(same.status).toBe(400);
    expect(same.body.error?.details?.[0]?.path).toEqual(["destinationAccountId"]);
    const missing = await call(txRoute.POST, "POST", "/api/transactions", {
      as: a,
      body: { type: "TRANSFER", amount: 10, transactionDate: today, accountId: bank },
    });
    expect(missing.status).toBe(400);
  });
});

describe("Scenario B — credit card purchase and repayment", () => {
  it("counts the purchase once as expense and the repayment as a liability transfer", async () => {
    const a = await newActor("Scenario B");
    const bank = (await createAccount(a, "Bank", "BANK", 10000)).id;
    const card = (await createAccount(a, "Card", "CREDIT_CARD", 0)).id;
    const shopping = await categoryId(a, "Shopping");

    await createTx(a, { type: "EXPENSE", amount: 2000, transactionDate: today, accountId: card, categoryId: shopping });
    let b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 10000, Card: -2000 });
    expect(b.summary).toMatchObject({ totalAssets: 10000, totalLiabilities: 2000, netWorth: 8000, liquid: 10000 });
    expect((await monthTotals(a)).netSpending).toBe(2000);

    await createTx(a, { type: "TRANSFER", amount: 2000, transactionDate: today, accountId: bank, destinationAccountId: card });
    b = await balances(a);
    expect(b.byName).toMatchObject({ Bank: 8000, Card: 0 });
    expect(b.summary).toMatchObject({ totalAssets: 8000, totalLiabilities: 0, netWorth: 8000 });
    expect((await monthTotals(a)).netSpending).toBe(2000);
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});

describe("planned transactions, versions and idempotency", () => {
  it("future-dated entries are PLANNED with no balance effect until posted", async () => {
    const a = await newActor("Planned");
    const bank = (await createAccount(a, "Bank", "BANK", 1000)).id;
    const rent = await categoryId(a, "Rent");
    const planned = await createTx(a, { type: "EXPENSE", amount: 400, transactionDate: addDays(today, 10), accountId: bank, categoryId: rent });
    expect(planned.status).toBe("PLANNED");
    expect((await balances(a)).byName.Bank).toBe(1000);

    const posted = await call(postRoute.POST, "POST", `/api/transactions/${planned.id}/post`, {
      as: a,
      params: { id: planned.id },
      body: { version: planned.version, transactionDate: today },
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.data.status).toBe("POSTED");
    expect((await balances(a)).byName.Bank).toBe(600);
  });

  it("rejects a stale edit with VERSION_CONFLICT and never overwrites", async () => {
    const a = await newActor("Versions");
    const bank = (await createAccount(a, "Bank", "BANK", 1000)).id;
    const food = await categoryId(a, "Food");
    const tx = await createTx(a, { type: "EXPENSE", amount: 100, transactionDate: today, accountId: bank, categoryId: food });
    const first = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: tx.id }, body: { version: tx.version, amount: 150 } });
    expect(first.status).toBe(200);
    const stale = await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: tx.id }, body: { version: tx.version, amount: 999 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
    expect((await balances(a)).byName.Bank).toBe(850);
  });

  it("replays a retried create with the same key exactly once, and rejects key reuse with a different payload", async () => {
    const a = await newActor("Idempotency");
    const bank = (await createAccount(a, "Bank", "BANK", 1000)).id;
    const food = await categoryId(a, "Food");
    const headers = idem();
    const body = { type: "EXPENSE", amount: 100, transactionDate: today, accountId: bank, categoryId: food };
    const [r1, r2] = await Promise.all([
      call(txRoute.POST, "POST", "/api/transactions", { as: a, body, headers }),
      call(txRoute.POST, "POST", "/api/transactions", { as: a, body, headers }),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.data.id).toBe(r2.body.data.id);
    const r3 = await call(txRoute.POST, "POST", "/api/transactions", { as: a, body, headers });
    expect(r3.body.data.id).toBe(r1.body.data.id);
    expect((await balances(a)).byName.Bank).toBe(900);

    const reuse = await call(txRoute.POST, "POST", "/api/transactions", { as: a, body: { ...body, amount: 101 }, headers });
    expect(reuse.status).toBe(422);
    expect(reuse.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("accounts: archive, delete rules, adjustments", () => {
  it("archives instead of deleting accounts with history and keeps them in net worth", async () => {
    const a = await newActor("Archive");
    const bank = await createAccount(a, "Bank", "BANK", 1000);
    const wallet = await createAccount(a, "Old wallet", "WALLET", 200);
    const food = await categoryId(a, "Food");
    await createTx(a, { type: "EXPENSE", amount: 50, transactionDate: today, accountId: wallet.id, categoryId: food });

    const del = await call(accountRoute.DELETE, "DELETE", "/x", { as: a, params: { id: wallet.id } });
    expect(del.status).toBe(422);
    expect(del.body.error?.code).toBe("ACCOUNT_HAS_HISTORY");

    const arch = await call(accountRoute.PATCH, "PATCH", "/x", { as: a, params: { id: wallet.id }, body: { version: wallet.version, archived: true } });
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
    const b = await balances(a);
    expect(b.summary.totalAssets).toBe(1150);

    // Archived accounts cannot receive new entries.
    const blocked = await call(txRoute.POST, "POST", "/api/transactions", {
      as: a,
      body: { type: "EXPENSE", amount: 5, transactionDate: today, accountId: wallet.id, categoryId: food },
    });
    expect(blocked.status).toBe(400);

    // An account with no history can be deleted.
    const empty = await createAccount(a, "Spare", "CASH", 0);
    const ok = await call(accountRoute.DELETE, "DELETE", "/x", { as: a, params: { id: empty.id } });
    expect(ok.status).toBe(200);
    expect(bank.id).toBeTruthy();
  });

  it("locks the opening balance once there is history and corrects via a dated adjustment", async () => {
    const a = await newActor("Adjust");
    const bank = await createAccount(a, "Bank", "BANK", 1000);
    const food = await categoryId(a, "Food");
    await createTx(a, { type: "EXPENSE", amount: 100, transactionDate: today, accountId: bank.id, categoryId: food });
    const locked = await call(accountRoute.PATCH, "PATCH", "/x", { as: a, params: { id: bank.id }, body: { version: bank.version, openingBalance: 5000 } });
    expect(locked.status).toBe(422);
    expect(locked.body.error?.code).toBe("OPENING_BALANCE_LOCKED");

    const adj = await call(adjustRoute.POST, "POST", "/x", { as: a, params: { id: bank.id }, body: { targetBalance: 1200, date: today, reason: "Bank statement" } });
    expect(adj.status, JSON.stringify(adj.body)).toBe(201);
    expect(adj.body.data.delta).toBe(300);
    expect((await balances(a)).byName.Bank).toBe(1200);
    // Adjustments are not income or spending.
    expect(await monthTotals(a)).toMatchObject({ income: 0, netSpending: 100 });
    expect(await verifyLedger(a.userId)).toEqual([]);
  });
});
