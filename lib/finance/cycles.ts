import {
  addDays,
  addMonthsClamped,
  maxISO,
  minISO,
  monthsBetween,
  parseISODate,
  startOfWeek,
  type DateRange,
  type ISODate,
} from "@/lib/dates/date-only";

export type BudgetPeriod = "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";

export interface BudgetSchedule {
  period: BudgetPeriod;
  /** Anchor and first day of the first cycle. */
  startDate: ISODate;
  /** Inclusive last day the budget applies (CUSTOM: required; recurring: optional stop). */
  endDate: ISODate | null;
}

export type CycleState = "upcoming" | "active" | "ended";

export interface BudgetCycle extends DateRange {
  /** 0-based cycle number from the anchor. */
  index: number;
  state: CycleState;
}

export interface CycleOptions {
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
}

function clampToSchedule(range: DateRange, schedule: BudgetSchedule): DateRange {
  const hardEnd = schedule.endDate ? addDays(schedule.endDate, 1) : null;
  return {
    start: maxISO(range.start, schedule.startDate),
    end: hardEnd ? minISO(range.end, hardEnd) : range.end,
  };
}

/** The k-th cycle (k ≥ 0) of a schedule, before clamping to start/stop dates. */
export function nthCycle(schedule: BudgetSchedule, k: number, opts: CycleOptions): DateRange {
  const { period, startDate } = schedule;
  switch (period) {
    case "CUSTOM":
      return { start: startDate, end: addDays(schedule.endDate ?? startDate, 1) };
    case "WEEKLY": {
      // Cycles follow the user's week boundary; the first cycle may be partial.
      const firstWeek = startOfWeek(startDate, opts.weekStartsOn);
      return { start: addDays(firstWeek, 7 * k), end: addDays(firstWeek, 7 * (k + 1)) };
    }
    case "MONTHLY": {
      const anchor = parseISODate(startDate).day;
      return {
        start: addMonthsClamped(startDate, k, anchor),
        end: addMonthsClamped(startDate, k + 1, anchor),
      };
    }
    case "YEARLY": {
      const anchor = parseISODate(startDate).day;
      return {
        start: addMonthsClamped(startDate, 12 * k, anchor),
        end: addMonthsClamped(startDate, 12 * (k + 1), anchor),
      };
    }
  }
}

/**
 * The budget cycle that applies on `ref`:
 *  - before the start date → the first cycle, state "upcoming"
 *  - after the stop/end date → the last cycle, state "ended"
 *  - otherwise the cycle containing ref, state "active"
 * Returned ranges are clamped to [startDate, endDate] and are start-inclusive /
 * end-exclusive.
 */
export function budgetCycleAt(schedule: BudgetSchedule, ref: ISODate, opts: CycleOptions): BudgetCycle {
  if (schedule.period === "CUSTOM") {
    const range = nthCycle(schedule, 0, opts);
    const state: CycleState = ref < range.start ? "upcoming" : ref >= range.end ? "ended" : "active";
    return { ...range, index: 0, state };
  }

  if (ref < schedule.startDate) {
    return { ...clampToSchedule(nthCycle(schedule, 0, opts), schedule), index: 0, state: "upcoming" };
  }

  const effectiveRef = schedule.endDate && ref > schedule.endDate ? schedule.endDate : ref;
  const k = locateCycleIndex(schedule, effectiveRef, opts);
  const range = clampToSchedule(nthCycle(schedule, k, opts), schedule);
  const state: CycleState = schedule.endDate && ref > schedule.endDate ? "ended" : "active";
  return { ...range, index: k, state };
}

function locateCycleIndex(schedule: BudgetSchedule, ref: ISODate, opts: CycleOptions): number {
  let k: number;
  switch (schedule.period) {
    case "WEEKLY": {
      const firstWeek = startOfWeek(schedule.startDate, opts.weekStartsOn);
      const refWeek = startOfWeek(ref, opts.weekStartsOn);
      const days = (Date.parse(refWeek) - Date.parse(firstWeek)) / 86_400_000;
      return Math.max(0, Math.round(days / 7));
    }
    case "MONTHLY":
      k = monthsBetween(schedule.startDate, ref);
      break;
    case "YEARLY":
      k = Math.floor(monthsBetween(schedule.startDate, ref) / 12);
      break;
    default:
      return 0;
  }
  k = Math.max(0, k);
  // Correct for the anchor day: step until start_k ≤ ref < start_{k+1}.
  for (let guard = 0; guard < 4; guard++) {
    const range = nthCycle(schedule, k, opts);
    if (ref < range.start && k > 0) k -= 1;
    else if (ref >= range.end) k += 1;
    else break;
  }
  return k;
}

/** Up to `count` cycles ending with (and including) the cycle at `ref`, oldest first. */
export function cyclesUpTo(schedule: BudgetSchedule, ref: ISODate, count: number, opts: CycleOptions): BudgetCycle[] {
  const current = budgetCycleAt(schedule, ref, opts);
  if (schedule.period === "CUSTOM" || current.state === "upcoming") return [current];
  const out: BudgetCycle[] = [];
  const first = Math.max(0, current.index - (count - 1));
  for (let k = first; k <= current.index; k++) {
    const range = clampToSchedule(nthCycle(schedule, k, opts), schedule);
    out.push({ ...range, index: k, state: k === current.index ? current.state : "ended" });
  }
  return out;
}
