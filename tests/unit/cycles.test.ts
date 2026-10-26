import { describe, it, expect } from "vitest";
import { budgetCycleAt, cyclesUpTo } from "@/lib/finance/cycles";
import {
  annualEquivalent,
  monthlyEquivalent,
  nextOccurrenceOnOrAfter,
  occurrenceAt,
  occurrencesBetween,
} from "@/lib/finance/recurrence";

const opts = { weekStartsOn: 1 };

describe("budget cycles", () => {
  it("monthly budgets reset every month on the anchor day", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-01-01", endDate: null };
    expect(budgetCycleAt(s, "2026-09-27", opts)).toMatchObject({ start: "2026-09-01", end: "2026-10-01", state: "active", index: 8 });
    expect(budgetCycleAt(s, "2026-10-01", opts)).toMatchObject({ start: "2026-10-01", end: "2026-11-01" });
  });

  it("monthly budgets anchored on the 25th follow payday cycles", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-01-25", endDate: null };
    expect(budgetCycleAt(s, "2026-09-10", opts)).toMatchObject({ start: "2026-08-25", end: "2026-09-25" });
    expect(budgetCycleAt(s, "2026-09-25", opts)).toMatchObject({ start: "2026-09-25", end: "2026-10-25" });
  });

  it("month-end anchors clamp and recover (31st)", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-01-31", endDate: null };
    expect(budgetCycleAt(s, "2026-02-15", opts)).toMatchObject({ start: "2026-01-31", end: "2026-02-28" });
    expect(budgetCycleAt(s, "2026-03-01", opts)).toMatchObject({ start: "2026-02-28", end: "2026-03-31" });
    expect(budgetCycleAt(s, "2026-03-31", opts)).toMatchObject({ start: "2026-03-31", end: "2026-04-30" });
  });

  it("weekly budgets follow the user's week boundary", () => {
    const s = { period: "WEEKLY" as const, startDate: "2026-09-02", endDate: null };
    // First cycle is partial: Wed 2 Sep → Mon 7 Sep.
    expect(budgetCycleAt(s, "2026-09-03", opts)).toMatchObject({ start: "2026-09-02", end: "2026-09-07", index: 0 });
    expect(budgetCycleAt(s, "2026-09-27", opts)).toMatchObject({ start: "2026-09-21", end: "2026-09-28", index: 3 });
    expect(budgetCycleAt(s, "2026-09-27", { weekStartsOn: 0 })).toMatchObject({ start: "2026-09-27", end: "2026-10-04" });
  });

  it("yearly budgets use the annual window including leap days", () => {
    const s = { period: "YEARLY" as const, startDate: "2024-02-29", endDate: null };
    expect(budgetCycleAt(s, "2025-06-01", opts)).toMatchObject({ start: "2025-02-28", end: "2026-02-28" });
    expect(budgetCycleAt(s, "2028-03-01", opts)).toMatchObject({ start: "2028-02-29", end: "2029-02-28" });
  });

  it("custom budgets cover exactly their inclusive dates", () => {
    const s = { period: "CUSTOM" as const, startDate: "2026-09-10", endDate: "2026-09-20" };
    expect(budgetCycleAt(s, "2026-09-15", opts)).toMatchObject({ start: "2026-09-10", end: "2026-09-21", state: "active" });
    expect(budgetCycleAt(s, "2026-09-21", opts).state).toBe("ended");
    expect(budgetCycleAt(s, "2026-09-01", opts).state).toBe("upcoming");
  });

  it("recurring budgets stop at their stop date", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-01-01", endDate: "2026-06-15" };
    expect(budgetCycleAt(s, "2026-06-10", opts)).toMatchObject({ start: "2026-06-01", end: "2026-06-16", state: "active" });
    expect(budgetCycleAt(s, "2026-09-01", opts)).toMatchObject({ start: "2026-06-01", end: "2026-06-16", state: "ended" });
  });

  it("future budgets are upcoming", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-11-01", endDate: null };
    expect(budgetCycleAt(s, "2026-09-27", opts)).toMatchObject({ start: "2026-11-01", end: "2026-12-01", state: "upcoming" });
  });

  it("lists trailing cycles oldest first", () => {
    const s = { period: "MONTHLY" as const, startDate: "2026-07-01", endDate: null };
    expect(cyclesUpTo(s, "2026-09-27", 5, opts).map((c) => c.start)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });
});

describe("recurrence", () => {
  it("keeps the original monthly anchor after short months", () => {
    const rule = { anchorDate: "2026-01-31", frequency: "MONTHLY" as const, interval: 1 };
    expect([0, 1, 2, 3].map((k) => occurrenceAt(rule, k))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("supports quarterly (every 3 months) and weekly intervals", () => {
    expect(occurrenceAt({ anchorDate: "2026-01-15", frequency: "MONTHLY", interval: 3 }, 2)).toBe("2026-07-15");
    expect(occurrenceAt({ anchorDate: "2026-09-01", frequency: "WEEKLY", interval: 2 }, 1)).toBe("2026-09-15");
  });

  it("enumerates occurrences within a range and honours the end date", () => {
    const rule = { anchorDate: "2026-09-05", frequency: "MONTHLY" as const, interval: 1, endDate: "2026-11-30" };
    expect(occurrencesBetween(rule, "2026-09-01", "2027-01-01")).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(nextOccurrenceOnOrAfter(rule, "2026-09-06")).toBe("2026-10-05");
    expect(nextOccurrenceOnOrAfter(rule, "2026-11-06")).toBeNull();
  });

  it("computes planning equivalents", () => {
    expect(monthlyEquivalent(1200, "YEARLY")).toBe(100);
    expect(monthlyEquivalent(300, "MONTHLY", 3)).toBe(100);
    expect(annualEquivalent(499, "MONTHLY")).toBe(5988);
  });
});
