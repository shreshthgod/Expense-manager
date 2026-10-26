import { describe, it, expect } from "vitest";
import { classifyIntent, parseAmount, parseReportPeriod } from "@/agents/intent-agent";

describe("parseAmount", () => {
  it("parses ₹ symbol", () => {
    expect(parseAmount("₹500")).toBe(500);
    expect(parseAmount("₹1,500")).toBe(1500);
  });

  it("parses rs/rupees", () => {
    expect(parseAmount("rs. 500")).toBe(500);
    expect(parseAmount("inr 1000")).toBe(1000);
    expect(parseAmount("rupees 5000")).toBe(5000);
  });

  it("parses k suffix", () => {
    expect(parseAmount("5k")).toBe(5000);
    expect(parseAmount("₹50k")).toBe(50000);
    expect(parseAmount("1.5k")).toBe(1500);
  });

  it("returns null for no amount", () => {
    expect(parseAmount("hello world")).toBeNull();
    expect(parseAmount("no numbers here")).toBeNull();
  });

  it("handles amount at end with currency", () => {
    expect(parseAmount("can i afford ₹5000")).toBe(5000);
    expect(parseAmount("budget for rs 10000")).toBe(10000);
  });

  it("handles amount with k suffix", () => {
    expect(parseAmount("can i afford 5k")).toBe(5000);
  });
});

describe("parseReportPeriod", () => {
  const now = new Date(2026, 2, 15); // March 15, 2026

  it("parses month name", () => {
    const result = parseReportPeriod("report for january 2026", now);
    expect(result).toEqual({ year: 2026, month: 1 });
  });

  it("parses quarter", () => {
    const result = parseReportPeriod("q1 report", now);
    expect(result).toEqual({ year: 2026, quarter: 1 });
  });

  it("parses 'this month'", () => {
    const result = parseReportPeriod("this month report", now);
    expect(result).toEqual({ year: 2026, month: 3 });
  });

  it("parses 'last month'", () => {
    const result = parseReportPeriod("last month report", now);
    expect(result).toEqual({ year: 2026, month: 2 });
  });

  it("parses 'this year'", () => {
    const result = parseReportPeriod("this year report", now);
    expect(result).toEqual({ year: 2026 });
  });

  it("returns null for no period", () => {
    expect(parseReportPeriod("hello world", now)).toBeNull();
  });
});

describe("classifyIntent", () => {
  it("classifies AFFORDABILITY_ANALYSIS", () => {
    const result = classifyIntent("can i afford a 50k bike");
    expect(result.intent).toBe("AFFORDABILITY_ANALYSIS");
    expect(result.amount).toBe(50000);
  });

  it("classifies REPORT_GENERATION", () => {
    const result = classifyIntent("generate monthly report for january 2026");
    expect(result.intent).toBe("REPORT_GENERATION");
    expect(result.reportPeriod).toEqual({ year: 2026, month: 1 });
  });

  it("classifies BUDGET_ANALYSIS", () => {
    const result = classifyIntent("how is my budget doing");
    expect(result.intent).toBe("BUDGET_ANALYSIS");
  });

  it("classifies GOAL_ANALYSIS", () => {
    const result = classifyIntent("what's my savings goal progress");
    expect(result.intent).toBe("GOAL_ANALYSIS");
  });

  it("classifies SUBSCRIPTION_ANALYSIS", () => {
    const result = classifyIntent("show my netflix subscription");
    expect(result.intent).toBe("SUBSCRIPTION_ANALYSIS");
  });

  it("classifies SAVINGS_ADVICE", () => {
    const result = classifyIntent("where can i save more");
    expect(result.intent).toBe("SAVINGS_ADVICE");
  });

  it("classifies SPENDING_ANALYSIS", () => {
    const result = classifyIntent("why did i spend so much");
    expect(result.intent).toBe("SPENDING_ANALYSIS");
  });

  it("defaults to GENERAL_QUESTION", () => {
    const result = classifyIntent("hello there");
    expect(result.intent).toBe("GENERAL_QUESTION");
  });
});
