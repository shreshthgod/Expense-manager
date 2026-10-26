import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { computeCarryIn } from "@/server/analytics/budget-status";
import { effectiveDeadlineOf, mapGoal } from "@/server/services/goal.service";
import { isGrounded, numbersFrom, numbersIn } from "@/agents/grounding";

describe("computeCarryIn", () => {
  it("NONE never carries", () => {
    expect(computeCarryIn("NONE", 3000, [0, 0])).toBe(0);
  });
  it("POSITIVE_ONLY carries unused money and resets after overspending", () => {
    expect(computeCarryIn("POSITIVE_ONLY", 3000, [2000, 3500])).toBe(500);
    expect(computeCarryIn("POSITIVE_ONLY", 3000, [4000, 1000])).toBe(2000);
  });
  it("FULL carries overspending forward", () => {
    expect(computeCarryIn("FULL", 3000, [4000, 1000])).toBe(1000);
    expect(computeCarryIn("FULL", 3000, [5000, 5000])).toBe(-4000);
  });
  it("is exact in paise", () => {
    expect(computeCarryIn("FULL", 0.3, [0.1, 0.1])).toBe(0.4);
  });
});

describe("goal projections", () => {
  const base = { id: "g", name: "G", category: null, description: null, version: 1, createdAt: new Date("2026-01-01T00:00:00Z") };
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  it("rolls a repeating sinking fund's deadline forward", () => {
    expect(effectiveDeadlineOf("2025-03-31", true, "2026-09-28")).toBe("2027-03-31");
    expect(effectiveDeadlineOf("2025-03-31", false, "2026-09-28")).toBe("2025-03-31");
  });
  it("projects completion from the planned pace, else the recent pace", () => {
    const g = mapGoal({ ...base, targetAmount: new Prisma.Decimal(10000), currentAmount: new Prisma.Decimal(1000), deadline: d("2027-01-31"), monthlyContribution: new Prisma.Decimal(2000) }, "2026-09-28");
    expect(g).toMatchObject({ pace: 2000, paceSource: "planned", expectedCompletion: "2027-02-28", onTrack: false });
    const r = mapGoal({ ...base, targetAmount: new Prisma.Decimal(10000), currentAmount: new Prisma.Decimal(1000), deadline: null }, "2026-09-28", { recentMonthlyPace: 3000 });
    expect(r).toMatchObject({ pace: 3000, paceSource: "recent", expectedCompletion: "2026-12-28", onTrack: null });
    const none = mapGoal({ ...base, targetAmount: new Prisma.Decimal(10000), currentAmount: new Prisma.Decimal(0), deadline: null }, "2026-09-28");
    expect(none.expectedCompletion).toBeNull();
  });
});

describe("AI number grounding", () => {
  it("extracts numbers from prose and data", () => {
    expect(numbersIn("You spent ₹12,500.50 on 3 things")).toEqual([12500.5, 3]);
    expect(numbersFrom({ a: 1, b: [2, { c: "₹3,000" }] })).toEqual([1, 2, 3000]);
  });
  it("accepts only figures present in the data (rounded forms allowed)", () => {
    const allowed = [12500.5, -3400, 18.75];
    expect(isGrounded("Spending was ₹12,500.50, up 18.8%, and you overspent ₹3,400.", allowed)).toBe(true);
    expect(isGrounded("Spending was ₹12,501.", allowed)).toBe(true);
    expect(isGrounded("You could save ₹9,999 next month.", allowed)).toBe(false);
    expect(isGrounded("Over 3 months in 2026 things improved.", allowed)).toBe(true);
  });
});
