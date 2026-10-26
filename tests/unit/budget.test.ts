import { describe, it, expect } from "vitest";
import { crossedThreshold } from "@/server/analytics/budget-status";

describe("crossedThreshold", () => {
  it("returns 100 for utilization >= 100", () => {
    expect(crossedThreshold(100)).toBe(100);
    expect(crossedThreshold(150)).toBe(100);
  });

  it("returns 90 for utilization 90-99", () => {
    expect(crossedThreshold(90)).toBe(90);
    expect(crossedThreshold(95)).toBe(90);
  });

  it("returns 75 for utilization 75-89", () => {
    expect(crossedThreshold(75)).toBe(75);
    expect(crossedThreshold(80)).toBe(75);
  });

  it("returns 50 for utilization 50-74", () => {
    expect(crossedThreshold(50)).toBe(50);
    expect(crossedThreshold(60)).toBe(50);
  });

  it("returns null for utilization < 50", () => {
    expect(crossedThreshold(0)).toBeNull();
    expect(crossedThreshold(25)).toBeNull();
    expect(crossedThreshold(49)).toBeNull();
  });
});

describe("crossedThreshold edge cases", () => {
  it("treats an exceeded budget as 100 even without a utilization (zero limit)", () => {
    expect(crossedThreshold(null, true)).toBe(100);
    expect(crossedThreshold(null)).toBeNull();
  });
});
