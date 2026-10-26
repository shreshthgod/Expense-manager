import {
  addDays,
  addMonthsClamped,
  financialMonthOf,
  makeISODate,
  parseISODate,
  previousRangeOf,
  startOfWeek,
  trailingFinancialMonths,
  type DateRange,
  type ISODate,
} from "@/lib/dates/date-only";
import type { RangePreset } from "@/lib/validation/schemas";

export type { DateRange, ISODate, RangePreset };

export interface PeriodSettings {
  weekStartsOn: number;
  monthStartDay: number;
}

export interface ResolvedPeriod {
  preset: RangePreset;
  range: DateRange;
  /** The comparable previous period (previous week/month/year, or equal length). */
  previous: DateRange;
  label: string;
}

function monthLabel(range: DateRange, monthStartDay: number): string {
  const { year, month } = parseISODate(monthStartDay > 1 ? addDays(range.end, -1) : range.start);
  const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  return monthStartDay > 1 ? `${name} ${year} cycle` : `${name} ${year}`;
}

/**
 * Resolves an analytics preset in the user's calendar. Month presets follow the
 * user's financial month (payday cycle) when monthStartDay > 1.
 */
export function resolvePeriod(
  preset: RangePreset,
  today: ISODate,
  settings: PeriodSettings,
  custom?: { startDate?: ISODate; endDate?: ISODate }
): ResolvedPeriod {
  const msd = Math.min(28, Math.max(1, settings.monthStartDay));
  const thisMonth = financialMonthOf(today, msd);
  switch (preset) {
    case "this_week": {
      const start = startOfWeek(today, settings.weekStartsOn);
      const range = { start, end: addDays(start, 7) };
      return { preset, range, previous: { start: addDays(start, -7), end: start }, label: "This week" };
    }
    case "last_month": {
      const range = financialMonthOf(addDays(thisMonth.start, -1), msd);
      const previous = financialMonthOf(addDays(range.start, -1), msd);
      return { preset, range, previous, label: monthLabel(range, msd) };
    }
    case "3_months":
    case "6_months": {
      const n = preset === "3_months" ? 3 : 6;
      const range = { start: addMonthsClamped(thisMonth.start, -(n - 1), msd), end: thisMonth.end };
      const previous = { start: addMonthsClamped(range.start, -n, msd), end: range.start };
      return { preset, range, previous, label: `Last ${n} months` };
    }
    case "this_year": {
      const { year } = parseISODate(today);
      const range = { start: makeISODate(year, 1, 1), end: makeISODate(year + 1, 1, 1) };
      return { preset, range, previous: { start: makeISODate(year - 1, 1, 1), end: range.start }, label: String(year) };
    }
    case "custom": {
      if (custom?.startDate && custom?.endDate) {
        const range = { start: custom.startDate, end: addDays(custom.endDate, 1) };
        return { preset, range, previous: previousRangeOf(range), label: "Custom range" };
      }
      return resolvePeriod("this_month", today, settings);
    }
    case "this_month":
    default: {
      const previous = financialMonthOf(addDays(thisMonth.start, -1), msd);
      return { preset: "this_month", range: thisMonth, previous, label: monthLabel(thisMonth, msd) };
    }
  }
}

/** Trailing financial months (oldest first) for trend charts. */
export function trailingMonths(today: ISODate, count: number, settings: PeriodSettings): DateRange[] {
  return trailingFinancialMonths(today, count, settings.monthStartDay);
}

/** Calendar-year quarter / month / year ranges for reports. */
export function reportRange(period: { year: number; month?: number; quarter?: number }): DateRange {
  if (period.month != null) {
    const start = makeISODate(period.year, period.month, 1);
    return { start, end: addMonthsClamped(start, 1, 1) };
  }
  if (period.quarter != null) {
    const start = makeISODate(period.year, (period.quarter - 1) * 3 + 1, 1);
    return { start, end: addMonthsClamped(start, 3, 1) };
  }
  return { start: makeISODate(period.year, 1, 1), end: makeISODate(period.year + 1, 1, 1) };
}
