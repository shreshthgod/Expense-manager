import {
  addDays,
  addMonthsClamped,
  makeISODate,
  parseISODate,
  startOfMonth,
  startOfWeek,
  type ISODate,
} from "@/lib/dates/date-only";

/**
 * Deterministic natural-language → transaction filter parser.
 *   "food expenses above 1000 last month"
 *   → { type: EXPENSE, categoryId: <Food>, minAmount: 1000, startDate, endDate }
 * The result is a plain filter object handed to the normal (deterministic)
 * transactions API — nothing here invents results. The optional AI parser
 * (POST /api/ai/parse-filter) must produce the same validated shape.
 */

export interface NaturalFilterParams {
  type?: "EXPENSE" | "INCOME" | "TRANSFER";
  categoryId?: string;
  minAmount?: string;
  maxAmount?: string;
  startDate?: ISODate;
  endDate?: ISODate;
  merchant?: string;
  search?: string;
}

export interface NaturalFilter {
  params: NaturalFilterParams;
  categoryName?: string;
  periodLabel?: string;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function num(raw: string): number | null {
  const m = raw.replace(/[₹,\s]/g, "").match(/^(\d+(?:\.\d+)?)(k|l|lakh|lac)?$/i);
  if (!m) return null;
  let v = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  if (unit === "k") v *= 1000;
  if (unit && unit.startsWith("l")) v *= 100000;
  return Number.isFinite(v) ? v : null;
}

const AMOUNT = String.raw`(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?\s*(?:k|l|lakh|lac)?)`;

export function parseNaturalFilter(text: string, today: ISODate, categories: { id: string; name: string; type?: string }[] = []): NaturalFilter | null {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const params: NaturalFilterParams = {};
  const result: NaturalFilter = { params };

  if (/\b(expenses?|spent|spend|spending|paid|purchases?)\b/.test(lower)) params.type = "EXPENSE";
  else if (/\b(income|earned|received|salary|credits?)\b/.test(lower)) params.type = "INCOME";
  else if (/\btransfers?\b/.test(lower)) params.type = "TRANSFER";

  const between = lower.match(new RegExp(`between ${AMOUNT} and ${AMOUNT}`));
  if (between) {
    const a = num(between[1]!);
    const b = num(between[2]!);
    if (a != null && b != null) {
      params.minAmount = String(Math.min(a, b));
      params.maxAmount = String(Math.max(a, b));
    }
  } else {
    const min = lower.match(new RegExp(`(?:above|over|more than|greater than|at least|>=?)\\s*${AMOUNT}`));
    const max = lower.match(new RegExp(`(?:below|under|less than|at most|<=?)\\s*${AMOUNT}`));
    const minV = min ? num(min[1]!) : null;
    const maxV = max ? num(max[1]!) : null;
    if (minV != null) params.minAmount = String(minV);
    if (maxV != null) params.maxAmount = String(maxV);
  }

  const { year, month } = parseISODate(today);
  const setRange = (start: ISODate, endInclusive: ISODate, label: string) => {
    params.startDate = start;
    params.endDate = endInclusive;
    result.periodLabel = label;
  };
  if (/\btoday\b/.test(lower)) setRange(today, today, "today");
  else if (/\byesterday\b/.test(lower)) setRange(addDays(today, -1), addDays(today, -1), "yesterday");
  else if (/\bthis week\b/.test(lower)) setRange(startOfWeek(today, 1), today, "this week");
  else if (/\blast week\b/.test(lower)) {
    const s = addDays(startOfWeek(today, 1), -7);
    setRange(s, addDays(s, 6), "last week");
  } else if (/\bthis month\b/.test(lower)) setRange(startOfMonth(today), today, "this month");
  else if (/\blast month\b/.test(lower)) {
    const s = addMonthsClamped(startOfMonth(today), -1, 1);
    setRange(s, addDays(startOfMonth(today), -1), "last month");
  } else if (/\bthis year\b/.test(lower)) setRange(makeISODate(year, 1, 1), today, "this year");
  else if (/\blast year\b/.test(lower)) setRange(makeISODate(year - 1, 1, 1), makeISODate(year - 1, 12, 31), "last year");
  else {
    const lastN = lower.match(/\b(?:last|past) (\d{1,3}) days?\b/);
    if (lastN) setRange(addDays(today, -(Number(lastN[1]) - 1)), today, `last ${lastN[1]} days`);
    else {
      const m = MONTHS.findIndex((name) => new RegExp(`\\b(in )?${name}\\b`).test(lower));
      if (m >= 0) {
        const y = Number(lower.match(/\b(20\d{2})\b/)?.[1] ?? (m + 1 > month ? year - 1 : year));
        const s = makeISODate(y, m + 1, 1);
        setRange(s, addDays(addMonthsClamped(s, 1, 1), -1), `${MONTHS[m]![0]!.toUpperCase()}${MONTHS[m]!.slice(1)} ${y}`);
      }
    }
  }

  // Longest category name that appears as a whole word.
  const byLength = [...categories].sort((a, b) => b.name.length - a.name.length);
  for (const c of byLength) {
    const escaped = c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(lower)) {
      params.categoryId = c.id;
      result.categoryName = c.name;
      if (!params.type && c.type && c.type !== "BOTH") params.type = c.type as "EXPENSE" | "INCOME";
      break;
    }
  }

  const at = lower.match(/\b(?:at|on|from) ([a-z0-9][a-z0-9 &'.-]{1,40}?)(?= (?:above|over|below|under|between|last|this|in|today|yesterday|more|less)\b| $)/);
  if (at && !/^(last|this|the|my)\b/.test(at[1]!) && !MONTHS.includes(at[1]!.trim())) {
    params.merchant = at[1]!.trim();
  }

  return Object.keys(params).length > 0 ? result : null;
}

export function describeFilter(f: NaturalFilter, money: (n: number) => string): string {
  const p = f.params;
  const parts: string[] = [];
  parts.push(p.type === "INCOME" ? "Income" : p.type === "TRANSFER" ? "Transfers" : p.type === "EXPENSE" ? "Expenses" : "Transactions");
  if (f.categoryName) parts.push(`in ${f.categoryName}`);
  if (p.merchant) parts.push(`at ${p.merchant}`);
  if (p.minAmount && p.maxAmount) parts.push(`between ${money(Number(p.minAmount))} and ${money(Number(p.maxAmount))}`);
  else if (p.minAmount) parts.push(`over ${money(Number(p.minAmount))}`);
  else if (p.maxAmount) parts.push(`under ${money(Number(p.maxAmount))}`);
  if (f.periodLabel) parts.push(f.periodLabel);
  return parts.join(" ");
}
