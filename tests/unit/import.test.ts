import { describe, it, expect } from "vitest";
import { detectDelimiter, parseCsv } from "@/lib/import/csv";
import { cleanMerchant, normalizeRow, parseImportAmount, parseImportDate } from "@/lib/import/normalize";
import { detectMapping, IMPORT_PRESETS, resolvePreset, suggestPreset } from "@/lib/import/presets";

describe("CSV parsing", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and a delimiter guess", () => {
    const csv = '﻿Date;Description;Amount\r\n01/09/2026;"Coffee; large";-120.50\r\n02/09/2026;"He said ""hi""";1,000\r\n';
    expect(detectDelimiter(csv)).toBe(";");
    const p = parseCsv(csv);
    expect(p.headers).toEqual(["Date", "Description", "Amount"]);
    expect(p.rows).toEqual([
      ["01/09/2026", "Coffee; large", "-120.50"],
      ["02/09/2026", 'He said "hi"', "1,000"],
    ]);
  });

  it("skips bank preamble lines above the real header", () => {
    const csv = "Account No,XXXX1234\nStatement for,Sep 2026\n\nDate,Narration,Withdrawal Amt.,Deposit Amt.\n01/09/26,UPI/1/SWIGGY/x,450.00,\n02/09/26,SALARY,,78000.00\n03/09/26,ATM,2000.00,\n";
    const p = parseCsv(csv);
    expect(p.headers[1]).toBe("Narration");
    expect(p.rows).toHaveLength(3);
  });
});

describe("normalisation", () => {
  it("parses dates in every supported format and rejects impossible ones", () => {
    expect(parseImportDate("27/09/2026", "DD/MM/YYYY")).toBe("2026-09-27");
    expect(parseImportDate("09/27/2026", "MM/DD/YYYY")).toBe("2026-09-27");
    expect(parseImportDate("27 Sep 2026", "DD MMM YYYY")).toBe("2026-09-27");
    expect(parseImportDate("27-Sep-26", "DD-MMM-YY")).toBe("2026-09-27");
    expect(parseImportDate("27/09/26", "DD/MM/YY")).toBe("2026-09-27");
    expect(parseImportDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseImportDate("yesterday", "DD/MM/YYYY")).toBeNull();
  });

  it("parses amounts with Indian grouping, signs, parentheses and Dr/Cr", () => {
    expect(parseImportAmount("1,23,456.78")).toEqual({ value: 123456.78, hint: null });
    expect(parseImportAmount("(500.00)")?.value).toBe(-500);
    expect(parseImportAmount("₹ 1,200 CR")).toEqual({ value: 1200, hint: "credit" });
    expect(parseImportAmount("450.00 Dr")).toEqual({ value: 450, hint: "debit" });
    expect(parseImportAmount("abc")).toBeNull();
    expect(parseImportAmount("")).toBeNull();
  });

  it("normalises rows for each amount mode and reports errors instead of guessing", () => {
    const headers = ["Date", "Narration", "Withdrawal Amt.", "Deposit Amt."];
    const mapping = resolvePreset(IMPORT_PRESETS.find((p) => p.id === "hdfc")!, headers);
    expect(normalizeRow(["01/09/26", "UPI/123/SWIGGY/ok", "450.00", ""], headers, mapping, 0)).toMatchObject({
      date: "2026-09-01",
      amount: 450,
      direction: "out",
      merchant: "SWIGGY",
      errors: [],
    });
    expect(normalizeRow(["01/09/26", "SALARY", "", "78,000.00"], headers, mapping, 1)).toMatchObject({ amount: 78000, direction: "in" });
    expect(normalizeRow(["99/99/26", "X", "", ""], headers, mapping, 2).errors).toHaveLength(2);
  });

  it("detects columns and presets from headers", () => {
    expect(suggestPreset(["Date", "Narration", "Chq./Ref.No.", "Withdrawal Amt.", "Deposit Amt."])?.id).toBe("hdfc");
    const m = detectMapping(["Txn Date", "Description", "Debit", "Credit"]);
    expect(m).toMatchObject({ date: "Txn Date", description: "Description", debit: "Debit", credit: "Credit", amountMode: "DEBIT_CREDIT" });
    expect(cleanMerchant("POS 4321 AMAZON RETAIL")).toBe("AMAZON RETAIL");
  });
});
