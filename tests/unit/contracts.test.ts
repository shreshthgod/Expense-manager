import { describe, it, expect } from "vitest";
import {
  accountCreateSchema,
  accountUpdateSchema,
  budgetCreateSchema,
  budgetUpdateSchema,
  goalCreateSchema,
  goalUpdateSchema,
  incomeCreateSchema,
  recurringCreateSchema,
  recurringUpdateSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
} from "@/lib/validation/schemas";
import {
  buildTransactionCreateBody,
  buildTransactionUpdateBody,
  emptyTransactionForm,
  switchTransactionType,
  transactionFormFromDTO,
} from "@/lib/forms/transaction";
import { budgetFormFromStatus, buildBudgetCreateBody, buildBudgetUpdateBody, emptyBudgetForm } from "@/lib/forms/budget";
import { buildGoalCreateBody, buildGoalUpdateBody, emptyGoalForm, goalFormFromStatus } from "@/lib/forms/goal";
import { buildAccountCreateBody, buildAccountUpdateBody, emptyAccountForm, signedOpening } from "@/lib/forms/account";
import { buildRecurringCreateBody, buildRecurringUpdateBody, emptyRecurringForm } from "@/lib/forms/recurring";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * CONTRACT TESTS: the exact JSON each form sends must parse with the schema of
 * the endpoint it is sent to. v1 shipped with every form rejected by its own
 * API (category NAMES sent as ids, nulls rejected, 1970 deadlines) because
 * nothing checked this. These tests make that class of bug fail CI.
 */

const ACC = "clx1234567890abcdefghijkl";
const ACC2 = "clx2234567890abcdefghijkl";
const CAT = "clx3234567890abcdefghijkl";
const TODAY = "2026-09-27";

describe("transaction form → POST /api/transactions and PATCH /api/transactions/:id", () => {
  it("expense with every optional field empty", () => {
    const s = { ...emptyTransactionForm({ today: TODAY }), amount: "1,250.50", accountId: ACC, categoryId: CAT };
    const parsed = transactionCreateSchema.parse(buildTransactionCreateBody(s));
    expect(parsed).toMatchObject({ amount: 1250.5, categoryId: CAT, destinationAccountId: null, merchant: null, notes: null });
  });

  it("income is accepted by both the transactions and the income endpoint", () => {
    const s = { ...emptyTransactionForm({ today: TODAY, type: "INCOME" }), amount: "5000", accountId: ACC, categoryId: CAT };
    const body = buildTransactionCreateBody(s);
    expect(transactionCreateSchema.safeParse(body).success).toBe(true);
    expect(incomeCreateSchema.safeParse(body).success).toBe(true);
  });

  it("switching to transfer clears the category and sends a destination", () => {
    const expense = { ...emptyTransactionForm({ today: TODAY }), amount: "300", accountId: ACC, categoryId: CAT };
    const transfer = { ...switchTransactionType(expense, "TRANSFER"), destinationAccountId: ACC2 };
    expect(transfer.categoryId).toBe("");
    const parsed = transactionCreateSchema.parse(buildTransactionCreateBody(transfer));
    expect(parsed).toMatchObject({ type: "TRANSFER", categoryId: null, destinationAccountId: ACC2 });
  });

  it("edit body round-trips from a DTO and carries the version", () => {
    const s = transactionFormFromDTO({
      type: "EXPENSE",
      amount: 42,
      transactionDate: TODAY,
      accountId: ACC,
      destinationAccountId: null,
      categoryId: CAT,
      merchant: null,
      description: "Lunch",
      paymentMethod: null,
      notes: null,
      tags: ["Work"],
      status: "POSTED",
    });
    const parsed = transactionUpdateSchema.parse(buildTransactionUpdateBody(s, 7));
    expect(parsed).toMatchObject({ version: 7, categoryId: CAT, tags: ["Work"], description: "Lunch" });
  });

  it("an unset category fails with a field error, never silently", () => {
    const s = { ...emptyTransactionForm({ today: TODAY }), amount: "10", accountId: ACC };
    const result = transactionCreateSchema.safeParse(buildTransactionCreateBody(s));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["categoryId"]);
  });
});

describe("budget form → /api/budgets", () => {
  it("overall and category budgets, create and edit (category preserved)", () => {
    const overall = { ...emptyBudgetForm(TODAY), name: "All spending", amount: "40000" };
    expect(budgetCreateSchema.parse(buildBudgetCreateBody(overall)).categoryId).toBeNull();
    const cat = { ...overall, categoryId: CAT };
    expect(budgetCreateSchema.parse(buildBudgetCreateBody(cat)).categoryId).toBe(CAT);

    const fromStatus = budgetFormFromStatus({
      id: "b", name: "Food", amount: 3000, period: "MONTHLY", startDate: TODAY, endDate: null, categoryId: CAT,
      categoryName: "Food", categoryColor: null, version: 2, rolloverMode: "POSITIVE_ONLY", carryIn: 0, available: 3000,
      cycle: { start: TODAY, end: TODAY, lastDay: TODAY, index: 0, state: "active" },
      spent: 0, remaining: 3000, utilization: 0, exceeded: false, daysInCycle: 30, daysElapsed: 1, daysRemaining: 29, elapsedPct: 3, projectedSpend: 0, aheadOfPace: false,
    });
    expect(fromStatus.categoryId).toBe(CAT);
    expect(budgetUpdateSchema.parse(buildBudgetUpdateBody(fromStatus, 2))).toMatchObject({ version: 2, categoryId: CAT, endDate: null, rolloverMode: "POSITIVE_ONLY" });
  });
});

describe("goal form → /api/goals", () => {
  it("create with every optional field blank; edit clearing the deadline yields null", () => {
    const s = { ...emptyGoalForm(), name: "Trip", targetAmount: "40000" };
    expect(goalCreateSchema.parse(buildGoalCreateBody(s))).toMatchObject({ deadline: null, category: null, description: null, currentAmount: 0 });
    const edit = goalFormFromStatus({
      id: "g", name: "Trip", kind: "SAVINGS", targetAmount: 40000, currentAmount: 100, remainingAmount: 39900, progressPct: 0.25, deadline: "2027-01-01",
      effectiveDeadline: "2027-01-01", daysRemaining: 90, overdue: false, completed: false, requiredMonthlySaving: 13300,
      monthlyContribution: null, pace: null, paceSource: null, expectedCompletion: null, onTrack: null, accountId: null, accountName: null,
      repeatsYearly: false, archived: false, completedAt: null, category: "Vacation", description: null, version: 4, createdAt: TODAY,
    });
    const parsed = goalUpdateSchema.parse(buildGoalUpdateBody({ ...edit, deadline: "" }, 4));
    expect(parsed.deadline).toBeNull();
    expect(parsed).toMatchObject({ accountId: null, monthlyContribution: null, kind: "SAVINGS" });
    expect("currentAmount" in parsed).toBe(false);
  });
});

describe("account form → /api/accounts", () => {
  it("liability amounts owed are sent as negative balances", () => {
    expect(signedOpening("CREDIT_CARD", "12,300")).toBe(-12300);
    expect(signedOpening("BANK", "500")).toBe(500);
    const card = { ...emptyAccountForm(TODAY, "CREDIT_CARD"), name: "Card", openingAmount: "1500" };
    expect(accountCreateSchema.parse(buildAccountCreateBody(card)).openingBalance).toBe(-1500);
    expect(accountUpdateSchema.safeParse(buildAccountUpdateBody(card, 1, { canEditOpening: false })).success).toBe(true);
  });
});

describe("recurring form → /api/recurring", () => {
  it("bills, subscriptions and recurring transfers", () => {
    const bill = { ...emptyRecurringForm(TODAY, "BILL"), name: "Rent", amount: "18000", accountId: ACC, categoryId: CAT };
    expect(recurringCreateSchema.safeParse(buildRecurringCreateBody(bill)).success).toBe(true);
    const sip = { ...emptyRecurringForm(TODAY), name: "SIP", type: "TRANSFER" as const, amount: "5000", accountId: ACC, destinationAccountId: ACC2, categoryId: CAT };
    const parsed = recurringCreateSchema.parse(buildRecurringCreateBody(sip));
    expect(parsed.categoryId).toBeNull();
    expect(recurringUpdateSchema.safeParse(buildRecurringUpdateBody(bill, 3)).success).toBe(true);
  });
});

describe("static: category templates are never used as runtime values", () => {
  it("no page or component imports DEFAULT_CATEGORIES (dropdowns must use DB ids)", () => {
    const roots = ["app", "components"].map((d) => path.resolve(__dirname, "../..", d));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?)$/.test(name) && !full.includes(`${path.sep}api${path.sep}`)) {
          if (/DEFAULT_CATEGORIES|EXPENSE_CATEGORIES|INCOME_CATEGORIES/.test(readFileSync(full, "utf8"))) offenders.push(full);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe("split transactions in the form", () => {
  const CAT2 = "clx4234567890abcdefghijkl";
  it("creates a split with no single category and exact line totals", () => {
    const s = { ...emptyTransactionForm({ today: TODAY }), amount: "5000", accountId: ACC, splits: [{ categoryId: CAT, amount: "3000", note: "" }, { categoryId: CAT2, amount: "2,000", note: "Soap" }] };
    const body = transactionCreateSchema.parse(buildTransactionCreateBody(s));
    expect(body.categoryId).toBeNull();
    expect(body.splits).toEqual([{ categoryId: CAT, amount: 3000, note: null }, { categoryId: CAT2, amount: 2000, note: "Soap" }]);
    const off = transactionCreateSchema.safeParse(buildTransactionCreateBody({ ...s, splits: [s.splits[0]!, { ...s.splits[1]!, amount: "1999.99" }] }));
    expect(off.success).toBe(false);
  });

  it("editing a split keeps it valid; removing the split sends null with a category", () => {
    const dto = {
      type: "EXPENSE" as const, amount: 5000, transactionDate: TODAY, accountId: ACC, destinationAccountId: null, categoryId: null,
      merchant: null, description: null, paymentMethod: null, notes: null, tags: [], status: "POSTED" as const,
      splits: [{ categoryId: CAT, amount: 3000, note: null }, { categoryId: CAT2, amount: 2000, note: null }],
    };
    const s = transactionFormFromDTO(dto);
    expect(s.splits).toHaveLength(2);
    expect(transactionCreateSchema.safeParse(buildTransactionCreateBody(s)).success).toBe(true);
    expect(transactionUpdateSchema.parse(buildTransactionUpdateBody(s, 3)).splits).toHaveLength(2);
    const single = transactionUpdateSchema.parse(buildTransactionUpdateBody({ ...s, splits: [], categoryId: CAT }, 3));
    expect(single).toMatchObject({ splits: null, categoryId: CAT });
  });
});
