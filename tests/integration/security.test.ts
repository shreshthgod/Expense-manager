import { describe, it, expect, beforeAll } from "vitest";
import { call, newActor, type Actor } from "../helpers/api";
import { CookieJar } from "../helpers/cookies";
import * as accountsRoute from "@/app/api/accounts/route";
import * as accountRoute from "@/app/api/accounts/[id]/route";
import * as txRoute from "@/app/api/transactions/route";
import * as txIdRoute from "@/app/api/transactions/[id]/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as categoryRoute from "@/app/api/categories/[id]/route";
import * as budgetsRoute from "@/app/api/budgets/route";
import * as budgetRoute from "@/app/api/budgets/[id]/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as reportsRoute from "@/app/api/reports/route";
import * as reportRoute from "@/app/api/reports/[id]/route";
import * as chatRoute from "@/app/api/ai/chat/route";
import * as conversationRoute from "@/app/api/ai/conversations/[id]/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as userRoute from "@/app/api/user/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as logoutRoute from "@/app/api/auth/logout/route";
import * as passwordRoute from "@/app/api/auth/password/route";
import * as sessionsRoute from "@/app/api/auth/sessions/route";
import * as cronRoute from "@/app/api/cron/run/route";
import { todayISO } from "@/lib/dates/date-only";

const today = todayISO("Asia/Kolkata");

describe("tenant isolation — user A cannot touch user B's data", () => {
  let a: Actor;
  let b: Actor;
  const bIds: Record<string, string> = {};

  beforeAll(async () => {
    a = await newActor("Alice");
    b = await newActor("Bob");
    const bAcc = await call(accountsRoute.POST, "POST", "/x", { as: b, body: { name: "B bank", type: "BANK", openingBalance: 500 } });
    bIds.account = bAcc.body.data.id;
    const bCats = await call(categoriesRoute.GET, "GET", "/x", { as: b });
    bIds.category = bCats.body.data.find((c: { name: string }) => c.name === "Food").id;
    const bTx = await call(txRoute.POST, "POST", "/x", {
      as: b,
      body: { type: "EXPENSE", amount: 50, transactionDate: today, accountId: bIds.account, categoryId: bIds.category },
    });
    bIds.tx = bTx.body.data.id;
    bIds.budget = (await call(budgetsRoute.POST, "POST", "/x", { as: b, body: { name: "B", amount: 100, period: "MONTHLY", startDate: today } })).body.data.id;
    bIds.goal = (await call(goalsRoute.POST, "POST", "/x", { as: b, body: { name: "B goal", targetAmount: 100 } })).body.data.id;
    bIds.report = (await call(reportsRoute.POST, "POST", "/x", { as: b, body: { type: "MONTHLY", year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) } })).body.data.id;
    bIds.conversation = (await call(chatRoute.POST, "POST", "/x", { as: b, body: { message: "How much did I spend?" } })).body.data.conversationId;
  });

  it("cannot read, edit or delete B's transaction", async () => {
    expect((await call(txIdRoute.GET, "GET", "/x", { as: a, params: { id: bIds.tx } })).status).toBe(404);
    expect((await call(txIdRoute.PATCH, "PATCH", "/x", { as: a, params: { id: bIds.tx }, body: { version: 1, amount: 1 } })).status).toBe(404);
    expect((await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: bIds.tx } })).status).toBe(404);
    const list = await call(txRoute.GET, "GET", "/x", { as: a });
    expect(list.body.data.items.find((t: { id: string }) => t.id === bIds.tx)).toBeUndefined();
  });

  it("cannot use B's account or category ids in its own transactions", async () => {
    const own = await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: "A bank", type: "BANK", openingBalance: 100 } });
    const aFood = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data.find((c: { name: string }) => c.name === "Food").id;
    const foreignCategory = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 5, transactionDate: today, accountId: own.body.data.id, categoryId: bIds.category },
    });
    expect(foreignCategory.status).toBe(400);
    expect(foreignCategory.body.error?.details?.[0]).toMatchObject({ path: ["categoryId"], message: "Category not found" });

    const foreignAccount = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 5, transactionDate: today, accountId: bIds.account, categoryId: aFood },
    });
    expect(foreignAccount.status).toBe(400);

    const transferInto = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "TRANSFER", amount: 5, transactionDate: today, accountId: own.body.data.id, destinationAccountId: bIds.account },
    });
    expect(transferInto.status).toBe(400);
    expect(transferInto.body.error?.details?.[0]?.path).toEqual(["destinationAccountId"]);

    // B's balance is untouched.
    const bAcc = await call(accountRoute.GET, "GET", "/x", { as: b, params: { id: bIds.account } });
    expect(bAcc.body.data.balance).toBe(450);
  });

  it("cannot read or delete B's account, category, budget, goal, report or conversation", async () => {
    expect((await call(accountRoute.GET, "GET", "/x", { as: a, params: { id: bIds.account } })).status).toBe(404);
    expect((await call(accountRoute.DELETE, "DELETE", "/x", { as: a, params: { id: bIds.account } })).status).toBe(404);
    expect((await call(categoryRoute.PATCH, "PATCH", "/x", { as: a, params: { id: bIds.category }, body: { color: "#000000" } })).status).toBe(404);
    expect((await call(budgetRoute.GET, "GET", "/x", { as: a, params: { id: bIds.budget } })).status).toBe(404);
    expect((await call(budgetRoute.DELETE, "DELETE", "/x", { as: a, params: { id: bIds.budget } })).status).toBe(404);
    expect((await call(goalRoute.DELETE, "DELETE", "/x", { as: a, params: { id: bIds.goal } })).status).toBe(404);
    expect((await call(reportRoute.GET, "GET", "/x", { as: a, params: { id: bIds.report } })).status).toBe(404);
    expect((await call(conversationRoute.GET, "GET", "/x", { as: a, params: { id: bIds.conversation } })).status).toBe(404);
    const hijack = await call(chatRoute.POST, "POST", "/x", { as: a, body: { message: "hi", conversationId: bIds.conversation } });
    expect(hijack.status).toBe(404);
  });

  it("rejects cross-site mutations (CSRF defence in depth)", async () => {
    const res = await call(goalsRoute.POST, "POST", "/x", {
      as: a,
      body: { name: "x", targetAmount: 1 },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    const fetchSite = await call(goalsRoute.POST, "POST", "/x", { as: a, body: { name: "x", targetAmount: 1 }, headers: { "sec-fetch-site": "cross-site" } });
    expect(fetchSite.status).toBe(403);
  });
});

describe("sessions — revocation is server-side", () => {
  it("logout revokes the session even if the cookie is replayed", async () => {
    const a = await newActor("Logout");
    const stolen = new CookieJar();
    stolen.restore(a.jar.snapshot());
    expect((await call(userRoute.GET, "GET", "/x", { as: a })).status).toBe(200);
    expect((await call(logoutRoute.POST, "POST", "/x", { as: a })).status).toBe(200);
    expect((await call(userRoute.GET, "GET", "/x", { as: a })).status).toBe(401);
    // The copied cookie is dead too.
    expect((await call(userRoute.GET, "GET", "/x", { as: { ...a, jar: stolen } })).status).toBe(401);
  });

  it("rejects tampered / invalid tokens", async () => {
    const a = await newActor("Tamper");
    const jar = new CookieJar();
    for (const c of a.jar.getAll()) jar.set(c.name, `${c.value.slice(0, -4)}abcd`);
    expect((await call(userRoute.GET, "GET", "/x", { as: { ...a, jar } })).status).toBe(401);
    const garbage = new CookieJar();
    garbage.set("em_session", "not-a-jwt");
    expect((await call(userRoute.GET, "GET", "/x", { as: { ...a, jar: garbage } })).status).toBe(401);
  });

  it("password change signs out other sessions but keeps the current one", async () => {
    const a = await newActor("Password");
    const second = new CookieJar();
    const login = await call(loginRoute.POST, "POST", "/x", { as: { ...a, jar: second }, body: { email: a.email, password: a.password } });
    expect(login.status).toBe(200);
    const sessions = await call(sessionsRoute.GET, "GET", "/x", { as: a });
    expect(sessions.body.data.sessions.length).toBe(2);

    const wrong = await call(passwordRoute.POST, "POST", "/x", { as: a, body: { currentPassword: "nope", newPassword: "N3wPassword!" } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error?.details?.[0]?.path).toEqual(["currentPassword"]);

    const changed = await call(passwordRoute.POST, "POST", "/x", { as: a, body: { currentPassword: a.password, newPassword: "N3wPassword!" } });
    expect(changed.status).toBe(200);
    expect(changed.body.data.revokedSessions).toBe(1);
    expect((await call(userRoute.GET, "GET", "/x", { as: a })).status).toBe(200);
    expect((await call(userRoute.GET, "GET", "/x", { as: { ...a, jar: second } })).status).toBe(401);

    const oldLogin = await call(loginRoute.POST, "POST", "/x", { as: { ...a, jar: new CookieJar() }, body: { email: a.email, password: a.password } });
    expect(oldLogin.status).toBe(401);
  });

  it("uses one error for unknown email and wrong password", async () => {
    const a = await newActor("Enumeration");
    const unknown = await call(loginRoute.POST, "POST", "/x", { body: { email: "nobody@test.local", password: "whatever1" } });
    const wrong = await call(loginRoute.POST, "POST", "/x", { body: { email: a.email, password: "wrongpass1" } });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it("deleting the user requires the password and the typed confirmation, then kills the session", async () => {
    const a = await newActor("Delete me");
    const noConfirm = await call(userRoute.DELETE, "DELETE", "/x", { as: a, body: { password: a.password } });
    expect(noConfirm.status).toBe(400);
    const badPassword = await call(userRoute.DELETE, "DELETE", "/x", { as: a, body: { password: "wrong", confirmation: "DELETE" } });
    expect(badPassword.status).toBe(400);
    const ok = await call(userRoute.DELETE, "DELETE", "/x", { as: a, body: { password: a.password, confirmation: "DELETE" } });
    expect(ok.status).toBe(200);
    expect((await call(userRoute.GET, "GET", "/x", { as: a })).status).toBe(401);
    const relogin = await call(loginRoute.POST, "POST", "/x", { body: { email: a.email, password: a.password } });
    expect(relogin.status).toBe(401);
  });
});

describe("scheduler authentication", () => {
  it("rejects missing or wrong cron credentials", async () => {
    expect((await call(cronRoute.POST, "POST", "/x")).status).toBe(401);
    expect((await call(cronRoute.POST, "POST", "/x", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = await call(cronRoute.POST, "POST", "/x", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
  });
});

describe("validation contract", () => {
  it("returns every field error with its path (for inline form errors)", async () => {
    const a = await newActor("Validation");
    const res = await call(txRoute.POST, "POST", "/x", { as: a, body: { type: "EXPENSE", amount: -5, transactionDate: "2026-02-30" } });
    expect(res.status).toBe(400);
    const paths = res.body.error!.details!.map((d) => d.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["amount", "transactionDate", "accountId"]));
  });

  it("validates notification pagination instead of crashing (v1 B17)", async () => {
    const a = await newActor("Pagination");
    const res = await call(notificationsRoute.GET, "GET", "/x", { as: a, query: { page: "abc" } });
    expect(res.status).toBe(400);
  });
});
