/**
 * Decimal-safe money helpers. All monetary aggregation happens in PostgreSQL
 * numeric columns; these helpers are used for small JS-side arithmetic and
 * always round half-up at 2 decimal places to avoid float drift.
 */
export function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  return numerator / denominator;
}

/** Percentage change from old to new; null when not computable. */
export function percentChange(oldValue: number, newValue: number): number | null {
  if (!oldValue || !Number.isFinite(oldValue)) return null;
  return round2(((newValue - oldValue) / Math.abs(oldValue)) * 100);
}

/** Percentage of total; returns 0 when total is 0 instead of NaN. */
export function percentageOf(total: number, part: number): number {
  return round2(safeDivide(part, total) * 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Money in integer minor units (paise/cents). JS floats cannot represent most
 * decimal fractions exactly, so every place that *accumulates* money (ledger
 * deltas, split sums, balance projections) works in minor units and converts
 * back once.
 */
export function toMinor(value: number | string | { toString(): string }): number {
  const n = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromMinor(minor: number): number {
  return Math.round(minor) / 100;
}

/** Exact sum of money values (rounded to 2 dp). */
export function addMoney(...values: (number | string | { toString(): string })[]): number {
  return fromMinor(values.reduce<number>((acc, v) => acc + toMinor(v), 0));
}

/** Exact difference a - b (rounded to 2 dp). */
export function subtractMoney(a: number | string | { toString(): string }, b: number | string | { toString(): string }): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Fixed-point decimal string suitable for Prisma Decimal columns. */
export function toDecimalString(value: number): string {
  return fromMinor(toMinor(value)).toFixed(2);
}

/** True when the value has at most two decimal places. */
export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}
