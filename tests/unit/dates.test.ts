import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonthsClamped,
  coerceISODate,
  dayOfWeek,
  diffDays,
  financialMonthOf,
  fromDbDate,
  isValidISODate,
  lastDayOfMonth,
  previousRangeOf,
  startOfWeek,
  toDbDate,
  todayISO,
  trailingFinancialMonths,
} from "@/lib/dates/date-only";

describe("date-only arithmetic", () => {
  it("validates real calendar dates only", () => {
    expect(isValidISODate("2024-02-29")).toBe(true);
    expect(isValidISODate("2025-02-29")).toBe(false);
    expect(isValidISODate("2025-13-01")).toBe(false);
    expect(isValidISODate("2025-1-01")).toBe(false);
    expect(isValidISODate("")).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });

  it("round-trips through the DB representation without drift", () => {
    for (const d of ["2026-01-01", "2026-03-29", "2026-10-25", "2024-02-29", "2026-12-31"]) {
      expect(fromDbDate(toDbDate(d))).toBe(d);
    }
  });

  it("evaluates today in the user's time zone", () => {
    // 2026-09-30T20:00Z is already Oct 1 in India but still Sep 30 in New York.
    const instant = new Date("2026-09-30T20:00:00Z");
    expect(todayISO("Asia/Kolkata", instant)).toBe("2026-10-01");
    expect(todayISO("America/New_York", instant)).toBe("2026-09-30");
    expect(todayISO("Not/AZone", instant)).toBe("2026-10-01");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(diffDays("2026-01-01", "2026-03-01")).toBe(59);
  });

  it("clamps month arithmetic to the anchor day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonthsClamped("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsClamped("2026-03-15", -3)).toBe("2025-12-15");
    expect(lastDayOfMonth("2026-02-10")).toBe("2026-02-28");
  });

  it("computes weekdays and week starts", () => {
    expect(dayOfWeek("2026-09-27")).toBe(0); // Sunday
    expect(dayOfWeek("1970-01-01")).toBe(4); // Thursday
    expect(startOfWeek("2026-09-27", 1)).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27", 0)).toBe("2026-09-27");
  });

  it("builds payday-based financial months", () => {
    expect(financialMonthOf("2026-09-27", 1)).toEqual({ start: "2026-09-01", end: "2026-10-01" });
    expect(financialMonthOf("2026-09-27", 25)).toEqual({ start: "2026-09-25", end: "2026-10-25" });
    expect(financialMonthOf("2026-09-10", 25)).toEqual({ start: "2026-08-25", end: "2026-09-25" });
    expect(trailingFinancialMonths("2026-03-10", 3, 1)).toEqual([
      { start: "2026-01-01", end: "2026-02-01" },
      { start: "2026-02-01", end: "2026-03-01" },
      { start: "2026-03-01", end: "2026-04-01" },
    ]);
  });

  it("derives previous ranges of equal length", () => {
    expect(previousRangeOf({ start: "2026-09-01", end: "2026-10-01" })).toEqual({ start: "2026-08-02", end: "2026-09-01" });
  });

  it("coerces date-time strings to calendar dates", () => {
    expect(coerceISODate("2026-09-27T18:30:00.000Z")).toBe("2026-09-27");
    expect(coerceISODate("2026-09-27")).toBe("2026-09-27");
    expect(coerceISODate("")).toBeNull();
    expect(coerceISODate("garbage")).toBeNull();
  });
});
