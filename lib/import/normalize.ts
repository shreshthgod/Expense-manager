import { isValidISODate, makeISODate, type ISODate } from "@/lib/dates/date-only";
import type { ImportMappingConfig } from "@/lib/validation/schemas";

/**
 * Statement row normalisation shared by the import wizard (preview) and the
 * server (authoritative). Nothing is guessed silently: unparseable dates and
 * amounts become row errors the user must resolve or skip.
 */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function year(y: string): number {
  const n = Number(y);
  return y.length === 2 ? (n >= 70 ? 1900 + n : 2000 + n) : n;
}

export function parseImportDate(raw: string, format: ImportMappingConfig["dateFormat"]): ISODate | null {
  const v = raw.trim().replace(/\s+/g, " ").split(" ").slice(0, format.includes("MMM") ? 3 : 1).join(" ");
  let d: number | undefined;
  let m: number | undefined;
  let y: number | undefined;
  const parts = v.split(/[/.\- ]/).filter(Boolean);
  switch (format) {
    case "DD/MM/YYYY":
    case "DD-MM-YYYY":
    case "DD.MM.YYYY":
    case "DD/MM/YY":
      [d, m, y] = [Number(parts[0]), Number(parts[1]), parts[2] ? year(parts[2]) : NaN];
      break;
    case "MM/DD/YYYY":
      [m, d, y] = [Number(parts[0]), Number(parts[1]), parts[2] ? year(parts[2]) : NaN];
      break;
    case "YYYY-MM-DD":
      [y, m, d] = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
      break;
    case "DD MMM YYYY":
    case "DD-MMM-YY":
      d = Number(parts[0]);
      m = MONTHS[(parts[1] ?? "").toLowerCase().slice(0, 4)] ?? MONTHS[(parts[1] ?? "").toLowerCase().slice(0, 3)];
      y = parts[2] ? year(parts[2]) : NaN;
      break;
  }
  if (!d || !m || !y || !Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  const iso = makeISODate(y, m, d);
  return isValidISODate(iso) ? iso : null;
}

/**
 * Parses "1,23,456.78", "(500.00)", "-500", "500.00 Dr", "₹ 1,200 CR".
 * Returns a signed number (negative = parentheses / minus / Dr suffix) or null.
 */
export function parseImportAmount(raw: string): { value: number; hint: "debit" | "credit" | null } | null {
  let s = raw.trim();
  if (!s) return null;
  let hint: "debit" | "credit" | null = null;
  const suffix = s.match(/\b(dr|cr|debit|credit)\.?$/i);
  if (suffix) {
    hint = suffix[1]!.toLowerCase().startsWith("d") ? "debit" : "credit";
    s = s.slice(0, suffix.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[₹$€£]|rs\.?|inr/gi, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const value = Math.round(Number(s) * 100) / 100;
  return { value: negative ? -value : value, hint };
}

export interface NormalizedRow {
  rowIndex: number;
  date: ISODate | null;
  /** Always positive. */
  amount: number | null;
  direction: "out" | "in" | null;
  description: string | null;
  merchant: string | null;
  categoryName: string | null;
  reference: string | null;
  errors: string[];
}

function cell(row: string[], headers: string[], column: string | null | undefined): string {
  if (!column) return "";
  const i = headers.indexOf(column);
  return i >= 0 ? (row[i] ?? "").trim() : "";
}

export function normalizeRow(row: string[], headers: string[], mapping: ImportMappingConfig, rowIndex: number): NormalizedRow {
  const errors: string[] = [];
  const rawDate = cell(row, headers, mapping.date);
  const date = rawDate ? parseImportDate(rawDate, mapping.dateFormat) : null;
  if (!rawDate) errors.push("Missing date");
  else if (!date) errors.push(`Unrecognised date "${rawDate}" (expected ${mapping.dateFormat})`);

  let amount: number | null = null;
  let direction: "out" | "in" | null = null;
  if (mapping.amountMode === "DEBIT_CREDIT") {
    const debit = parseImportAmount(cell(row, headers, mapping.debit));
    const credit = parseImportAmount(cell(row, headers, mapping.credit));
    if (debit && Math.abs(debit.value) > 0) {
      amount = Math.abs(debit.value);
      direction = "out";
    } else if (credit && Math.abs(credit.value) > 0) {
      amount = Math.abs(credit.value);
      direction = "in";
    } else errors.push("No debit or credit amount");
  } else {
    const rawAmount = cell(row, headers, mapping.amount);
    const parsed = parseImportAmount(rawAmount);
    if (!parsed || parsed.value === 0) errors.push(rawAmount ? `Invalid amount "${rawAmount}"` : "Missing amount");
    else {
      amount = Math.abs(parsed.value);
      if (mapping.amountMode === "TYPE_COLUMN") {
        const t = cell(row, headers, mapping.type).toLowerCase();
        if (/^(dr|debit|d|withdrawal|expense|out)/.test(t)) direction = "out";
        else if (/^(cr|credit|c|deposit|income|in)/.test(t)) direction = "in";
        else if (parsed.hint) direction = parsed.hint === "debit" ? "out" : "in";
        else errors.push(`Unknown debit/credit marker "${t}"`);
      } else if (parsed.hint) {
        direction = parsed.hint === "debit" ? "out" : "in";
      } else {
        const outflow = mapping.positiveIsExpense ? parsed.value > 0 : parsed.value < 0;
        direction = outflow ? "out" : "in";
      }
    }
  }
  if (amount != null && amount > 99_999_999_999) errors.push("Amount is too large");

  const description = cell(row, headers, mapping.description) || null;
  const merchant = cell(row, headers, mapping.merchant) || null;
  return {
    rowIndex,
    date,
    amount,
    direction,
    description: description ? description.slice(0, 240) : null,
    merchant: merchant ? merchant.slice(0, 120) : description ? cleanMerchant(description) : null,
    categoryName: cell(row, headers, mapping.category) || null,
    reference: cell(row, headers, mapping.reference) || null,
    errors,
  };
}

/** Best-effort merchant from a bank narration ("UPI/123/SWIGGY/..." → "SWIGGY"). */
export function cleanMerchant(narration: string): string | null {
  const n = narration.trim();
  const upi = n.match(/^UPI[/-](?:[^/]*\/)?([A-Za-z][A-Za-z0-9 .&'-]{2,40})/i);
  if (upi) return upi[1]!.trim().slice(0, 120);
  const pos = n.match(/^(?:POS|ECOM|NEFT|IMPS|ACH|NACH)[\s/*-]+(?:\d+[\s/*-]+)?([A-Za-z][A-Za-z0-9 .&'-]{2,40})/i);
  if (pos) return pos[1]!.trim().slice(0, 120);
  return n.slice(0, 60) || null;
}
