import { addDays, addMonthsClamped, parseISODate, type ISODate } from "@/lib/dates/date-only";

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  /** First occurrence; its day-of-month is the anchor for monthly/yearly rules. */
  anchorDate: ISODate;
  frequency: RecurrenceFrequency;
  /** Every N units (1 = every month, 3 = quarterly …). */
  interval: number;
  /** Inclusive last possible occurrence date. */
  endDate?: ISODate | null;
}

/**
 * The k-th occurrence (k ≥ 0) of a rule. Monthly/yearly occurrences are always
 * computed from the ORIGINAL anchor, so Jan 31 → Feb 28 (29) → Mar 31 rather
 * than drifting to the 28th forever.
 */
export function occurrenceAt(rule: RecurrenceRule, k: number): ISODate {
  const step = Math.max(1, Math.trunc(rule.interval || 1));
  switch (rule.frequency) {
    case "DAILY":
      return addDays(rule.anchorDate, k * step);
    case "WEEKLY":
      return addDays(rule.anchorDate, 7 * k * step);
    case "MONTHLY":
      return addMonthsClamped(rule.anchorDate, k * step, parseISODate(rule.anchorDate).day);
    case "YEARLY":
      return addMonthsClamped(rule.anchorDate, 12 * k * step, parseISODate(rule.anchorDate).day);
  }
}

/** Occurrence dates d with from ≤ d < to (bounded by `limit`). */
export function occurrencesBetween(rule: RecurrenceRule, from: ISODate, to: ISODate, limit = 400): ISODate[] {
  const out: ISODate[] = [];
  for (let k = 0; k < 20_000 && out.length < limit; k++) {
    const d = occurrenceAt(rule, k);
    if (rule.endDate && d > rule.endDate) break;
    if (d >= to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The first occurrence on or after `from`, or null when the rule has ended. */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, from: ISODate): ISODate | null {
  for (let k = 0; k < 20_000; k++) {
    const d = occurrenceAt(rule, k);
    if (rule.endDate && d > rule.endDate) return null;
    if (d >= from) return d;
  }
  return null;
}

/** Approximate monthly cost of a recurring amount (planning estimate, not an actual total). */
export function monthlyEquivalent(amount: number, frequency: RecurrenceFrequency, interval = 1): number {
  const n = Math.max(1, interval);
  switch (frequency) {
    case "DAILY":
      return (amount * 365) / 12 / n;
    case "WEEKLY":
      return (amount * 52) / 12 / n;
    case "MONTHLY":
      return amount / n;
    case "YEARLY":
      return amount / 12 / n;
  }
}

export function annualEquivalent(amount: number, frequency: RecurrenceFrequency, interval = 1): number {
  return monthlyEquivalent(amount, frequency, interval) * 12;
}

export function describeRecurrence(frequency: RecurrenceFrequency, interval = 1): string {
  const n = Math.max(1, interval);
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[frequency];
  if (n === 1) return { DAILY: "Daily", WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly" }[frequency];
  if (frequency === "MONTHLY" && n === 3) return "Quarterly";
  if (frequency === "MONTHLY" && n === 6) return "Every 6 months";
  return `Every ${n} ${unit}s`;
}
