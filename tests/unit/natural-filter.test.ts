import { describe, it, expect } from "vitest";
import { describeFilter, parseNaturalFilter } from "@/lib/finance/natural-filter";

const TODAY = "2026-09-27";
const cats = [
  { id: "c_food", name: "Food", type: "EXPENSE" },
  { id: "c_sal", name: "Salary", type: "INCOME" },
  { id: "c_pc", name: "Personal Care", type: "EXPENSE" },
];
const money = (n: number) => `₹${n}`;

describe("natural-language filters (deterministic)", () => {
  it("parses the canonical example", () => {
    const f = parseNaturalFilter("Show food expenses above ₹1000 from last month", TODAY, cats)!;
    expect(f.params).toMatchObject({ type: "EXPENSE", categoryId: "c_food", minAmount: "1000", startDate: "2026-08-01", endDate: "2026-08-31" });
    expect(describeFilter(f, money)).toBe("Expenses in Food over ₹1000 last month");
  });

  it("handles ranges, k-suffixes, named months and multi-word categories", () => {
    expect(parseNaturalFilter("personal care between 500 and 2k in march", TODAY, cats)!.params).toMatchObject({
      categoryId: "c_pc",
      minAmount: "500",
      maxAmount: "2000",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(parseNaturalFilter("spent at swiggy this week", TODAY, cats)!.params).toMatchObject({ type: "EXPENSE", merchant: "swiggy", startDate: "2026-09-21" });
    expect(parseNaturalFilter("salary last 90 days", TODAY, cats)!.params).toMatchObject({ type: "INCOME", categoryId: "c_sal", startDate: "2026-06-30" });
  });

  it("returns null when nothing structured is recognised", () => {
    expect(parseNaturalFilter("hello there", TODAY, cats)).toBeNull();
  });
});
