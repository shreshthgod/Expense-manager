import { describe, it, expect, beforeAll } from "vitest";
import { call, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as txRoute from "@/app/api/transactions/route";
import * as incomeRoute from "@/app/api/income/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as categoryRoute from "@/app/api/categories/[id]/route";
import * as budgetsRoute from "@/app/api/budgets/route";
import * as budgetRoute from "@/app/api/budgets/[id]/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as notificationRoute from "@/app/api/notifications/[id]/route";
import * as chatRoute from "@/app/api/ai/chat/route";
import * as conversationRoute from "@/app/api/ai/conversations/[id]/route";
import * as onboardingRoute from "@/app/api/onboarding/route";
import * as dashboardRoute from "@/app/api/dashboard/route";
import { notify } from "@/server/services/notification.service";
import { prisma } from "@/lib/db/prisma";
import { todayISO } from "@/lib/dates/date-only";

/** One regression test per confirmed v1 bug (docs/KNOWN_ISSUES.md B1–B13). */

const today = todayISO("Asia/Kolkata");

describe("v1 regressions", () => {
  let a: Actor;
  let bank: string;
  let cats: { id: string; name: string; type: string }[];
  const id = (name: string) => cats.find((c) => c.name === name)!.id;

  beforeAll(async () => {
    a = await newActor("Regressions");
    bank = (await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: "Bank", type: "BANK", openingBalance: 10000 } })).body.data.id;
    cats = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data;
  });

  it("B1/S1 — a transaction created with a category NAME is rejected; with the DB id it saves", async () => {
    const byName = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 10, transactionDate: today, accountId: bank, categoryId: "Food" },
    });
    expect(byName.status).toBe(400);
    const byId = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 10, transactionDate: today, accountId: bank, categoryId: id("Food") },
    });
    expect(byId.status).toBe(201);
    expect(byId.body.data.category.name).toBe("Food");
  });

  it("B2 — income uses DB income categories and rejects expense categories", async () => {
    const ok = await call(incomeRoute.POST, "POST", "/x", { as: a, body: { amount: 5000, transactionDate: today, accountId: bank, categoryId: id("Salary") } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.type).toBe("INCOME");
    const wrong = await call(incomeRoute.POST, "POST", "/x", { as: a, body: { amount: 5000, transactionDate: today, accountId: bank, categoryId: id("Food") } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.details?.[0]?.message).toMatch(/income category/i);
  });

  it("B3/B4/B10 — budgets save with a category, keep it on edit and accept an explicit null", async () => {
    const created = await call(budgetsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Food", amount: 3000, period: "MONTHLY", startDate: `${today.slice(0, 7)}-01`, categoryId: id("Food") },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const b = created.body.data;
    const renamed = await call(budgetRoute.PATCH, "PATCH", "/x", { as: a, params: { id: b.id }, body: { version: b.version, name: "Food & dining" } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.categoryId).toBe(id("Food"));
    const overall = await call(budgetRoute.PATCH, "PATCH", "/x", {
      as: a,
      params: { id: b.id },
      body: { version: renamed.body.data.version, categoryId: null },
    });
    expect(overall.status, JSON.stringify(overall.body)).toBe(200);
    expect(overall.body.data.categoryId).toBeNull();
  });

  it("B5/B6 — goals accept null optional fields and a cleared deadline is null, never 1970", async () => {
    const created = await call(goalsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "Trip", targetAmount: 20000, deadline: `${Number(today.slice(0, 4)) + 1}-01-15`, category: null, description: null },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const g = created.body.data;
    const cleared = await call(goalRoute.PATCH, "PATCH", "/x", {
      as: a,
      params: { id: g.id },
      body: { version: g.version, deadline: "", category: null, description: "" },
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.data.deadline).toBeNull();
    expect(cleared.body.data.overdue).toBe(false);
    const row = await prisma.savingsGoal.findUnique({ where: { id: g.id } });
    expect(row?.deadline).toBeNull();
  });

  it("B7/B16 — marking a notification read never deletes it; delete is explicit", async () => {
    await notify({ userId: a.userId, type: "REPORT_GENERATED", title: "Hello", message: "World", dedupeKey: "regression:b7" });
    const list = await call(notificationsRoute.GET, "GET", "/x", { as: a });
    const n = list.body.data.items[0];
    const read = await call(notificationRoute.PATCH, "PATCH", "/x", { as: a, params: { id: n.id }, body: { read: true } });
    expect(read.status).toBe(200);
    expect(read.body.data.read).toBe(true);
    const after = await call(notificationsRoute.GET, "GET", "/x", { as: a });
    expect(after.body.data.items.find((x: { id: string }) => x.id === n.id)?.read).toBe(true);
    // Dedupe survives reading: the same event does not notify twice.
    expect(await notify({ userId: a.userId, type: "REPORT_GENERATED", title: "Hello", message: "World", dedupeKey: "regression:b7" })).toBe("duplicate");
    expect((await call(notificationRoute.DELETE, "DELETE", "/x", { as: a, params: { id: n.id } })).status).toBe(200);
  });

  it("B8 — the category filter works with DB ids (and an invalid id is a visible 400)", async () => {
    const filtered = await call(txRoute.GET, "GET", "/x", { as: a, query: { categoryId: id("Food") } });
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items.length).toBeGreaterThan(0);
    expect(filtered.body.data.items.every((t: { category: { name: string } }) => t.category.name === "Food")).toBe(true);
    const bad = await call(txRoute.GET, "GET", "/x", { as: a, query: { categoryId: "Food" } });
    expect(bad.status).toBe(400);
  });

  it("B9 — chat continues the same conversation", async () => {
    const first = await call(chatRoute.POST, "POST", "/x", { as: a, body: { message: "How much did I spend this month?" } });
    expect(first.status).toBe(200);
    const convo = first.body.data.conversationId;
    const second = await call(chatRoute.POST, "POST", "/x", { as: a, body: { message: "And my budgets?", conversationId: convo } });
    expect(second.body.data.conversationId).toBe(convo);
    const history = await call(conversationRoute.GET, "GET", "/x", { as: a, params: { id: convo } });
    expect(history.body.data.messages.length).toBe(4);
  });

  it("B11 — onboarding creates a real account exactly once, even when a step is retried", async () => {
    const u = await newActor("Onboarding");
    const step = { step: "account", name: "Primary bank", type: "BANK", openingBalance: 25000 };
    const r1 = await call(onboardingRoute.POST, "POST", "/x", { as: u, body: step });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const r2 = await call(onboardingRoute.POST, "POST", "/x", { as: u, body: { ...step, openingBalance: 26000 } });
    expect(r2.status).toBe(200);
    const accounts = await call(accountsRoute.GET, "GET", "/x", { as: u });
    expect(accounts.body.data.accounts).toHaveLength(1);
    expect(accounts.body.data.accounts[0].balance).toBe(26000);
    expect(accounts.body.data.summary.liquid).toBe(26000);
  });

  it("S6 — GET /api/dashboard performs no writes", async () => {
    const before = await prisma.transaction.count({ where: { userId: a.userId } });
    const notifBefore = await prisma.notification.count({ where: { userId: a.userId } });
    const res = await call(dashboardRoute.GET, "GET", "/x", { as: a });
    expect(res.status).toBe(200);
    expect(await prisma.transaction.count({ where: { userId: a.userId } })).toBe(before);
    expect(await prisma.notification.count({ where: { userId: a.userId } })).toBe(notifBefore);
  });

  it("B18 — two users can own a category with the same name; a user can't duplicate it", async () => {
    const other = await newActor("Other");
    const mine = await call(categoriesRoute.POST, "POST", "/x", { as: a, body: { name: "Pets", type: "EXPENSE" } });
    const theirs = await call(categoriesRoute.POST, "POST", "/x", { as: other, body: { name: "Pets", type: "EXPENSE" } });
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    const dup = await call(categoriesRoute.POST, "POST", "/x", { as: a, body: { name: "pets", type: "EXPENSE" } });
    expect(dup.status).toBe(400);
    expect(dup.body.error?.details?.[0]?.path).toEqual(["name"]);
  });

  it("categories in use can only be deleted with reassignment; defaults can only be archived", async () => {
    const custom = await call(categoriesRoute.POST, "POST", "/x", { as: a, body: { name: "Coffee", type: "EXPENSE" } });
    await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 120, transactionDate: today, accountId: bank, categoryId: custom.body.data.id },
    });
    const blocked = await call(categoryRoute.DELETE, "DELETE", "/x", { as: a, params: { id: custom.body.data.id } });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.code).toBe("CATEGORY_IN_USE");
    const moved = await call(categoryRoute.DELETE, "DELETE", "/x", {
      as: a,
      params: { id: custom.body.data.id },
      query: { reassignTo: id("Food") },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.reassigned).toBe(1);
    const system = await call(categoryRoute.DELETE, "DELETE", "/x", { as: a, params: { id: id("Travel") } });
    expect(system.status).toBe(422);
    const archived = await call(categoryRoute.PATCH, "PATCH", "/x", { as: a, params: { id: id("Travel") }, body: { archived: true } });
    expect(archived.body.data.archived).toBe(true);
  });
});
