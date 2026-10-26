import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { mapGoal } from "@/server/services/goal.service";

const base = {
  id: "g1",
  name: "Goal",
  category: null,
  description: null,
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const money = (v: number) => new Prisma.Decimal(v);
const TODAY = "2026-09-27";

describe("mapGoal (date-only, deterministic)", () => {
  it("calculates basic status without a deadline", () => {
    const g = mapGoal({ ...base, targetAmount: money(100000), currentAmount: money(40000), deadline: null }, TODAY);
    expect(g).toMatchObject({ remainingAmount: 60000, progressPct: 40, overdue: false, requiredMonthlySaving: null, deadline: null, completed: false });
  });

  it("computes required monthly saving from whole remaining months", () => {
    const g = mapGoal({ ...base, targetAmount: money(24000), currentAmount: money(0), deadline: d("2027-09-22") }, TODAY);
    expect(g.daysRemaining).toBe(360);
    expect(g.requiredMonthlySaving).toBe(2000);
  });

  it("marks past deadlines with money left as overdue", () => {
    const g = mapGoal({ ...base, targetAmount: money(1000), currentAmount: money(200), deadline: d("2026-09-01") }, TODAY);
    expect(g.overdue).toBe(true);
    expect(g.requiredMonthlySaving).toBeNull();
  });

  it("caps progress at 100% and is never overdue when complete", () => {
    const g = mapGoal({ ...base, targetAmount: money(1000), currentAmount: money(1500), deadline: d("2026-01-01") }, TODAY);
    expect(g).toMatchObject({ progressPct: 100, remainingAmount: 0, overdue: false, completed: true });
  });

  it("returns the deadline as a calendar date string (no 1970 or timezone drift)", () => {
    const g = mapGoal({ ...base, targetAmount: money(1), currentAmount: money(0), deadline: d("2026-12-31") }, TODAY);
    expect(g.deadline).toBe("2026-12-31");
  });

  it("handles zero targets without dividing by zero", () => {
    const g = mapGoal({ ...base, targetAmount: money(0), currentAmount: money(0), deadline: null }, TODAY);
    expect(g.progressPct).toBe(0);
  });
});
