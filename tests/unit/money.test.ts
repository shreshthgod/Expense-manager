import { describe, it, expect } from "vitest";
import {
  round2,
  safeDivide,
  percentChange,
  percentageOf,
  clamp,
  mean,
  stdDeviation,
  sum,
} from "@/lib/utils/money";

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(2.3456)).toBe(2.35);
    expect(round2(10)).toBe(10);
    expect(round2(0.1)).toBe(0.1);
  });

  it("handles NaN and Infinity", () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
    expect(round2(-Infinity)).toBe(0);
  });

  it("handles negatives", () => {
    expect(round2(-2.3456)).toBe(-2.35);
    expect(round2(-0.006)).toBe(-0.01);
  });

  it("rounds common monetary values correctly", () => {
    expect(round2(19.999)).toBe(20);
    expect(round2(19.991)).toBe(19.99);
    expect(round2(100.005)).toBe(100.01);
  });
});

describe("safeDivide", () => {
  it("divides normally", () => {
    expect(safeDivide(10, 2)).toBe(5);
  });

  it("returns 0 for zero denominator", () => {
    expect(safeDivide(10, 0)).toBe(0);
    expect(safeDivide(10, NaN)).toBe(0);
    expect(safeDivide(10, Infinity)).toBe(0);
  });

  it("handles zero numerator", () => {
    expect(safeDivide(0, 5)).toBe(0);
  });
});

describe("percentChange", () => {
  it("calculates percentage change", () => {
    expect(percentChange(100, 150)).toBe(50);
    expect(percentChange(200, 100)).toBe(-50);
  });

  it("returns null for zero/NaN old value", () => {
    expect(percentChange(0, 100)).toBeNull();
    expect(percentChange(NaN, 100)).toBeNull();
  });
});

describe("percentageOf", () => {
  it("calculates percentage", () => {
    expect(percentageOf(200, 50)).toBe(25);
    expect(percentageOf(100, 100)).toBe(100);
  });

  it("returns 0 for zero total", () => {
    expect(percentageOf(0, 50)).toBe(0);
  });
});

describe("clamp", () => {
  it("clamps value within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("mean", () => {
  it("calculates mean", () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(mean([5])).toBe(5);
  });

  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });
});

describe("stdDeviation", () => {
  it("returns 0 for fewer than 2 values", () => {
    expect(stdDeviation([])).toBe(0);
    expect(stdDeviation([5])).toBe(0);
  });

  it("calculates standard deviation", () => {
    const result = stdDeviation([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2.0, 0);
  });
});

describe("sum", () => {
  it("sums array", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
  });
});

import { formatMoney } from "@/lib/utils/format";

describe("formatMoney decimals", () => {
  it("never shows a single decimal digit", () => {
    expect(formatMoney(1176.3, "INR")).toBe("₹1,176.30");
    expect(formatMoney(509111.6, "INR")).toBe("₹5,09,111.60");
    expect(formatMoney(18000, "INR")).toBe("₹18,000");
    expect(formatMoney(-2708.23, "INR")).toBe("-₹2,708.23");
  });
});
