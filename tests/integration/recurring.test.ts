import { describe, it, expect } from "vitest";
import { call, idem, newActor, type Actor } from "../helpers/api";
import * as accountsRoute from "@/app/api/accounts/route";
import * as categoriesRoute from "@/app/api/categories/route";
import * as recurringRoute from "@/app/api/recurring/route";
import * as recurringIdRoute from "@/app/api/recurring/[id]/route";
import * as stateRoute from "@/app/api/recurring/[id]/state/route";
import * as settleRoute from "@/app/api/recurring/[id]/occurrences/[date]/settle/route";
import * as occurrenceRoute from "@/app/api/recurring/[id]/occurrences/[date]/route";
import * as txIdRoute from "@/app/api/transactions/[id]/route";
import * as scheduleRoute from "@/app/api/schedule/route";
import { processRecurring } from "@/server/services/recurring.service";
import { verifyLedger } from "@/server/services/account.service";
import { prisma } from "@/lib/db/prisma";
import { addDays, addMonthsClamped, todayISO } from "@/lib/dates/date-only";

const today = todayISO("Asia/Kolkata");

async function setup(name: string) {
  const a = await newActor(name);
  const bank = (await call(accountsRoute.POST, "POST", "/x", { as: a, body: { name: "Bank", type: "BANK", openingBalance: 10000 } })).body.data.id as string;
  const cats = (await call(categoriesRoute.GET, "GET", "/x", { as: a })).body.data as { id: string; name: string }[];
  return { a, bank, cat: (n: string) => cats.find((c) => c.name === n)!.id };
}

async function balance(a: Actor) {
  const res = await call(accountsRoute.GET, "GET", "/x", { as: a });
  return res.body.data.accounts[0].balance as number;
}

/** Moves a rule's cursor into the past so the processor sees due occurrences. */
async function backdate(ruleId: string, firstDue: string) {
  await prisma.recurringTransaction.update({
    where: { id: ruleId },
    data: { startDate: new Date(`${firstDue}T00:00:00Z`), nextExecutionDate: new Date(`${firstDue}T00:00:00Z`) },
  });
}

describe("recurring engine", () => {
  it("Scenario C — concurrent workers + manual payment settle a subscription occurrence exactly once", async () => {
    const { a, bank, cat } = await setup("Scenario C");
    const created = await call(recurringRoute.POST, "POST", "/x", {
      as: a,
      body: {
        kind: "SUBSCRIPTION",
        name: "Streaming",
        type: "EXPENSE",
        amount: 999,
        accountId: bank,
        categoryId: cat("Subscriptions"),
        frequency: "MONTHLY",
        startDate: today,
        autoCreate: true,
      },
      headers: idem(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ruleId = created.body.data.id;
    expect(created.body.data.nextDueDate).toBe(today);

    // Two workers and a manual "mark paid" race for the same occurrence.
    const results = await Promise.allSettled([
      processRecurring({ userId: a.userId }),
      processRecurring({ userId: a.userId }),
      call(settleRoute.POST, "POST", "/x", { as: a, params: { id: ruleId, date: today }, body: { mode: "create" } }),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const occurrences = await prisma.recurringOccurrence.findMany({ where: { recurringId: ruleId } });
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.status).toBe("RECORDED");
    const txs = await prisma.transaction.findMany({ where: { userId: a.userId, recurringTransactionId: ruleId, deletedAt: null } });
    expect(txs).toHaveLength(1);
    expect(await balance(a)).toBe(10000 - 999);

    // Running the processor again changes nothing.
    await processRecurring({ userId: a.userId });
    expect(await prisma.transaction.count({ where: { userId: a.userId, recurringTransactionId: ruleId, deletedAt: null } })).toBe(1);

    // Projections count the settled occurrence once.
    const schedule = await call(scheduleRoute.GET, "GET", "/x", { as: a, query: { from: today, to: addDays(today, 40) } });
    const forRule = schedule.body.data.filter((i: { ruleId: string }) => i.ruleId === ruleId);
    expect(forRule.filter((i: { date: string }) => i.date === today)).toHaveLength(1);
    expect(forRule[0].status).toBe("RECORDED");
    expect(await verifyLedger(a.userId)).toEqual([]);
  });

  it("catches up missed occurrences (bounded) and keeps the month-end anchor", async () => {
    const { a, bank, cat } = await setup("Catch up");
    const rule = (
      await call(recurringRoute.POST, "POST", "/x", {
        as: a,
        body: { name: "Gym", type: "EXPENSE", amount: 100, accountId: bank, categoryId: cat("Personal Care"), frequency: "MONTHLY", startDate: today, autoCreate: true },
      })
    ).body.data;
    const threeMonthsAgo = addMonthsClamped(today, -3);
    await backdate(rule.id, threeMonthsAgo);
    const summary = await processRecurring({ userId: a.userId });
    expect(summary.transactionsCreated).toBe(4); // -3, -2, -1 months and today
    expect(await balance(a)).toBe(10000 - 400);
    const next = await call(recurringIdRoute.GET, "GET", "/x", { as: a, params: { id: rule.id } });
    expect(next.body.data.nextDueDate > today).toBe(true);
  });

  it("reminder-only bills wait for payment; paying twice is rejected; deleting the payment reopens the bill", async () => {
    const { a, bank, cat } = await setup("Bills");
    const bill = (
      await call(recurringRoute.POST, "POST", "/x", {
        as: a,
        body: { kind: "BILL", name: "Electricity", type: "EXPENSE", amount: 1500, accountId: bank, categoryId: cat("Utilities"), frequency: "MONTHLY", startDate: today, autoCreate: false },
      })
    ).body.data;
    await processRecurring({ userId: a.userId });
    let detail = await call(recurringIdRoute.GET, "GET", "/x", { as: a, params: { id: bill.id } });
    expect(detail.body.data.state).toBe("DUE_TODAY");
    expect(detail.body.data.outstanding.dueDate).toBe(today);
    expect(await balance(a)).toBe(10000);

    const paid = await call(settleRoute.POST, "POST", "/x", { as: a, params: { id: bill.id, date: today }, body: { mode: "create", amount: 1620 } });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(await balance(a)).toBe(10000 - 1620);

    const again = await call(settleRoute.POST, "POST", "/x", { as: a, params: { id: bill.id, date: today }, body: { mode: "create" } });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("ALREADY_SETTLED");

    const del = await call(txIdRoute.DELETE, "DELETE", "/x", { as: a, params: { id: paid.body.data.transactionId } });
    expect(del.status).toBe(200);
    detail = await call(recurringIdRoute.GET, "GET", "/x", { as: a, params: { id: bill.id } });
    expect(detail.body.data.outstanding?.dueDate).toBe(today);
    expect(await balance(a)).toBe(10000);
  });

  it("links an existing payment instead of creating a duplicate expense", async () => {
    const { a, bank, cat } = await setup("Link");
    const txRoute = await import("@/app/api/transactions/route");
    const existing = await call(txRoute.POST, "POST", "/x", {
      as: a,
      body: { type: "EXPENSE", amount: 799, transactionDate: today, accountId: bank, categoryId: cat("Bills"), merchant: "ISP" },
    });
    const bill = (
      await call(recurringRoute.POST, "POST", "/x", {
        as: a,
        body: { kind: "BILL", name: "Internet", type: "EXPENSE", amount: 799, accountId: bank, categoryId: cat("Bills"), frequency: "MONTHLY", startDate: today },
      })
    ).body.data;
    const linked = await call(settleRoute.POST, "POST", "/x", {
      as: a,
      params: { id: bill.id, date: today },
      body: { mode: "link", transactionId: existing.body.data.id },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    expect(await balance(a)).toBe(10000 - 799);
    expect(await prisma.transaction.count({ where: { userId: a.userId, deletedAt: null } })).toBe(1);
    // The processor will not generate the (already settled) occurrence again.
    await processRecurring({ userId: a.userId });
    expect(await prisma.transaction.count({ where: { userId: a.userId, deletedAt: null } })).toBe(1);
  });

  it("pause stops generation; resume with 'skip' does not record missed occurrences", async () => {
    const { a, bank, cat } = await setup("Pause");
    const rule = (
      await call(recurringRoute.POST, "POST", "/x", {
        as: a,
        body: { name: "Tuition", type: "EXPENSE", amount: 500, accountId: bank, categoryId: cat("Education"), frequency: "WEEKLY", startDate: today, autoCreate: true },
      })
    ).body.data;
    const paused = await call(stateRoute.POST, "POST", "/x", { as: a, params: { id: rule.id }, body: { action: "pause", version: rule.version } });
    expect(paused.body.data.state).toBe("PAUSED");
    await backdate(rule.id, addDays(today, -21));
    await processRecurring({ userId: a.userId });
    expect(await balance(a)).toBe(10000);
    const resumed = await call(stateRoute.POST, "POST", "/x", {
      as: a,
      params: { id: rule.id },
      body: { action: "resume", version: paused.body.data.version, missed: "skip" },
    });
    expect(resumed.status).toBe(200);
    await processRecurring({ userId: a.userId });
    // Only today's occurrence (if on schedule) may be recorded; the three missed weeks are not.
    expect(await balance(a)).toBeGreaterThanOrEqual(10000 - 500);
  });

  it("skipping one occurrence leaves the others intact", async () => {
    const { a, bank, cat } = await setup("Skip");
    const rule = (
      await call(recurringRoute.POST, "POST", "/x", {
        as: a,
        body: { name: "Newspaper", type: "EXPENSE", amount: 50, accountId: bank, categoryId: cat("Bills"), frequency: "DAILY", startDate: today, autoCreate: true },
      })
    ).body.data;
    const skipped = await call(occurrenceRoute.PATCH, "PATCH", "/x", { as: a, params: { id: rule.id, date: today }, body: { action: "skip" } });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    await processRecurring({ userId: a.userId });
    expect(await balance(a)).toBe(10000);
    const off = await call(occurrenceRoute.PATCH, "PATCH", "/x", { as: a, params: { id: rule.id, date: addDays(today, 3) }, body: { action: "skip" } });
    expect(off.status).toBe(200);
    const notOnSchedule = await call(occurrenceRoute.PATCH, "PATCH", "/x", {
      as: a,
      params: { id: rule.id, date: "1999-01-01" },
      body: { action: "skip" },
    });
    expect(notOnSchedule.status).toBe(400);
  });
});
