/**
 * Calendar-date arithmetic without time zones.
 *
 * Policy (see docs/BUSINESS_LOGIC.md §Dates):
 *  - Financial dates (transaction date, budget start, due dates…) are calendar
 *    dates stored in PostgreSQL `DATE` columns and exchanged as "YYYY-MM-DD".
 *  - "Today" is evaluated in the user's IANA time zone (default Asia/Kolkata).
 *  - Ranges are start-inclusive / end-exclusive: { start, end } covers
 *    start ≤ d < end.
 *  - Audit timestamps (createdAt/updatedAt) remain UTC instants.
 *
 * All arithmetic here uses Date.UTC so the host time zone never matters.
 */

export type ISODate = string;

export interface DateRange {
  /** Inclusive first day. */
  start: ISODate;
  /** Exclusive end (the day after the last included day). */
  end: ISODate;
}

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function parseISODate(value: ISODate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO date "${value}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function makeISODate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days in a 1-based month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toEpochDay(value: ISODate): number {
  const { year, month, day } = parseISODate(value);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function fromEpochDay(epochDay: number): ISODate {
  const d = new Date(epochDay * DAY_MS);
  return makeISODate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** UTC-midnight Date for writing a Prisma `@db.Date` column. */
export function toDbDate(value: ISODate): Date {
  const { year, month, day } = parseISODate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Reads a Prisma `@db.Date` value (UTC midnight) back as a calendar date. */
export function fromDbDate(value: Date): ISODate {
  return value.toISOString().slice(0, 10);
}

export function fromDbDateOrNull(value: Date | null | undefined): ISODate | null {
  return value ? fromDbDate(value) : null;
}

const todayFormatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar date "now" in the given IANA time zone. */
export function todayISO(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): ISODate {
  let fmt = todayFormatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: DEFAULT_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    todayFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function addDays(value: ISODate, days: number): ISODate {
  return fromEpochDay(toEpochDay(value) + days);
}

/** b − a in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: ISODate): number {
  // 1970-01-01 (epoch day 0) was a Thursday.
  return (((toEpochDay(value) + 4) % 7) + 7) % 7;
}

/**
 * Adds calendar months while keeping an anchor day-of-month: the result is the
 * anchor day, clamped to the target month's length. Anchoring on the original
 * day (not the previous result) is what makes Jan 31 → Feb 28 → Mar 31.
 */
export function addMonthsClamped(value: ISODate, months: number, anchorDay?: number): ISODate {
  const { year, month, day } = parseISODate(value);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const wanted = anchorDay ?? day;
  return makeISODate(y, m, Math.min(wanted, daysInMonth(y, m)));
}

export function startOfMonth(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return makeISODate(year, month, 1);
}

/** Exclusive end of the calendar month containing `value`. */
export function startOfNextMonth(value: ISODate): ISODate {
  return addMonthsClamped(startOfMonth(value), 1, 1);
}

export function lastDayOfMonth(value: ISODate): ISODate {
  return addDays(startOfNextMonth(value), -1);
}

export function startOfYear(value: ISODate): ISODate {
  return makeISODate(parseISODate(value).year, 1, 1);
}

export function startOfWeek(value: ISODate, weekStartsOn = 1): ISODate {
  const dow = dayOfWeek(value);
  const back = (dow - weekStartsOn + 7) % 7;
  return addDays(value, -back);
}

export function monthKey(value: ISODate): string {
  return value.slice(0, 7);
}

/** Whole months from a to b (calendar months, ignoring days). */
export function monthsBetween(a: ISODate, b: ISODate): number {
  const pa = parseISODate(a);
  const pb = parseISODate(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

export function inRange(value: ISODate, range: DateRange): boolean {
  return value >= range.start && value < range.end;
}

export function rangeLengthDays(range: DateRange): number {
  return diffDays(range.start, range.end);
}

/** Inclusive last day of a range. */
export function lastDayOf(range: DateRange): ISODate {
  return addDays(range.end, -1);
}

/** The equally-long range immediately before `range`. */
export function previousRangeOf(range: DateRange): DateRange {
  const len = rangeLengthDays(range);
  return { start: addDays(range.start, -len), end: range.start };
}

/**
 * Financial month containing `value` for a payday/month-start day (1-28).
 * monthStartDay = 1 gives calendar months; 25 gives 25th → 24th cycles.
 */
export function financialMonthOf(value: ISODate, monthStartDay = 1): DateRange {
  const msd = Math.min(28, Math.max(1, Math.trunc(monthStartDay)));
  const { year, month, day } = parseISODate(value);
  const start = day >= msd ? makeISODate(year, month, msd) : addMonthsClamped(makeISODate(year, month, msd), -1, msd);
  return { start, end: addMonthsClamped(start, 1, msd) };
}

/** Month ranges (financial months) covering the trailing `count` months ending with the one containing `value`. */
export function trailingFinancialMonths(value: ISODate, count: number, monthStartDay = 1): DateRange[] {
  const current = financialMonthOf(value, monthStartDay);
  const out: DateRange[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addMonthsClamped(current.start, -i, Math.min(28, Math.max(1, monthStartDay)));
    out.push({ start, end: addMonthsClamped(start, 1, Math.min(28, Math.max(1, monthStartDay))) });
  }
  return out;
}

/** Coerces an ISO date-time or date string into a calendar date (first 10 chars). */
export function coerceISODate(value: unknown): ISODate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return fromDbDate(value);
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return isValidISODate(head) ? head : null;
}
