import { describe, it, expect } from "vitest";
import {
  accountCreateSchema,
  budgetCreateSchema,
  budgetUpdateSchema,
  goalCreateSchema,
  goalUpdateSchema,
  loginSchema,
  moneyAmount,
  onboardingStepSchema,
  recurringCreateSchema,
  registerSchema,
  transactionCreateSchema,
  transactionQuerySchema,
} from "@/lib/validation/schemas";

const ID = "clx1234567890abcdefghijkl";
const ID2 = "clx0987654321abcdefghijkl";

describe("money primitive", () => {
  it("normalises to exact cents and rejects float noise beyond 2 decimals", () => {
    expect(moneyAmount.parse("1,234.50")).toBe(1234.5);
    expect(moneyAmount.parse(0.1 + 0.2)).toBe(0.3);
    expect(moneyAmount.safeParse(10.555).success).toBe(false);
    expect(moneyAmount.safeParse(0).success).toBe(false);
    expect(moneyAmount.safeParse(-5).success).toBe(false);
    expect(moneyAmount.safeParse("").success).toBe(false);
    expect(moneyAmount.safeParse(1e13).success).toBe(false);
  });
});

describe("transactionCreateSchema", () => {
  const valid = { type: "EXPENSE", amount: 250, transactionDate: "2026-09-27", accountId: ID, categoryId: ID2 };

  it("accepts a valid expense and keeps the date as a calendar date", () => {
    const r = transactionCreateSchema.parse({ ...valid, transactionDate: "2026-09-27T18:30:00.000Z" });
    expect(r.transactionDate).toBe("2026-09-27");
  });

  it("requires a category for expenses and income (and never accepts a name)", () => {
    const missing = transactionCreateSchema.safeParse({ ...valid, categoryId: null });
    expect(missing.success).toBe(false);
    const name = transactionCreateSchema.safeParse({ ...valid, categoryId: "Food" });
    expect(name.success).toBe(false);
  });

  it("requires distinct source and destination for transfers and forbids a category", () => {
    expect(transactionCreateSchema.safeParse({ ...valid, type: "TRANSFER", categoryId: null, destinationAccountId: ID2 }).success).toBe(true);
    expect(transactionCreateSchema.safeParse({ ...valid, type: "TRANSFER", categoryId: null, destinationAccountId: ID }).success).toBe(false);
    expect(transactionCreateSchema.safeParse({ ...valid, type: "TRANSFER", categoryId: ID2, destinationAccountId: ID2 }).success).toBe(false);
  });

  it("rejects impossible dates", () => {
    expect(transactionCreateSchema.safeParse({ ...valid, transactionDate: "2026-02-30" }).success).toBe(false);
  });

  it("deduplicates tags case-insensitively", () => {
    expect(transactionCreateSchema.parse({ ...valid, tags: ["Travel", "travel", "Work"] }).tags).toEqual(["Travel", "Work"]);
  });
});

describe("transactionQuerySchema", () => {
  it("applies defaults and validates ranges", () => {
    expect(transactionQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20, sortBy: "transactionDate", sortDir: "desc" });
    expect(transactionQuerySchema.safeParse({ minAmount: "500", maxAmount: "100" }).success).toBe(false);
    expect(transactionQuerySchema.safeParse({ pageSize: "37" }).success).toBe(false);
  });
});

describe("budget schemas (null handling — v1 B3/B10)", () => {
  it("custom budgets need an end date after the start", () => {
    expect(budgetCreateSchema.safeParse({ name: "Trip", amount: 100, period: "CUSTOM", startDate: "2026-09-01" }).success).toBe(false);
    expect(budgetCreateSchema.safeParse({ name: "Trip", amount: 100, period: "CUSTOM", startDate: "2026-09-10", endDate: "2026-09-01" }).success).toBe(false);
  });
  it("PATCH accepts an explicit null category and an empty end date", () => {
    const r = budgetUpdateSchema.parse({ version: 3, categoryId: null, endDate: "" });
    expect(r.categoryId).toBeNull();
    expect(r.endDate).toBeNull();
  });
});

describe("goal schemas (null handling — v1 B5/B6)", () => {
  it("create accepts nulls for every optional field", () => {
    const r = goalCreateSchema.parse({ name: "Fund", targetAmount: 1000, deadline: null, category: null, description: null });
    expect(r).toMatchObject({ deadline: null, category: null, description: null });
  });
  it("an empty or null deadline becomes null, never 1970-01-01", () => {
    expect(goalUpdateSchema.parse({ version: 1, deadline: "" }).deadline).toBeNull();
    expect(goalUpdateSchema.parse({ version: 1, deadline: null }).deadline).toBeNull();
    expect(goalUpdateSchema.parse({ version: 1 }).deadline).toBeUndefined();
  });
});

describe("other schemas", () => {
  it("accounts accept signed opening balances (liabilities are negative)", () => {
    expect(accountCreateSchema.parse({ name: "Card", type: "CREDIT_CARD", openingBalance: -1200 }).openingBalance).toBe(-1200);
    expect(accountCreateSchema.safeParse({ name: "", type: "BANK" }).success).toBe(false);
  });
  it("recurring bills must be expenses", () => {
    expect(
      recurringCreateSchema.safeParse({ kind: "BILL", name: "Rent", type: "INCOME", amount: 1, accountId: ID, categoryId: ID2, frequency: "MONTHLY", startDate: "2026-09-01" }).success
    ).toBe(false);
  });
  it("onboarding steps validate conditionally", () => {
    expect(onboardingStepSchema.safeParse({ step: "account", skip: true }).success).toBe(true);
    expect(onboardingStepSchema.safeParse({ step: "account" }).success).toBe(false);
    expect(onboardingStepSchema.safeParse({ step: "account", name: "Bank", type: "BANK", openingBalance: 0 }).success).toBe(true);
  });
  it("auth schemas", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "Ann", email: "a@b.co", password: "short1" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "Ann", email: "a@b.co", password: "longenough" }).success).toBe(false);
    expect(registerSchema.safeParse({ name: "Ann", email: "a@b.co", password: "longenough1" }).success).toBe(true);
  });
});
