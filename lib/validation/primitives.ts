import { z } from "zod";
import { coerceISODate, isValidISODate, type ISODate } from "@/lib/dates/date-only";
import { fromMinor, hasAtMostTwoDecimals, toMinor } from "@/lib/utils/money";

/**
 * Shared zod building blocks. Every nullable field states its null handling
 * explicitly — v1 bugs B3/B5/B6 came from schemas that silently rejected `null`
 * or coerced `null` into 1970-01-01.
 *
 *  - `optional()`  → key may be omitted (PATCH: "leave unchanged")
 *  - `null`        → explicit "clear this value"
 *  - `""`          → treated as `null` for text/date/id inputs coming from forms
 */

const MAX_MONEY = 99_999_999_999.99; // fits NUMERIC(14,2)

function toNumber(v: unknown): unknown {
  if (typeof v === "string") {
    const trimmed = v.replace(/,/g, "").trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  }
  return v;
}

/** Strictly positive money with at most 2 decimals, normalised to exact cents. */
export const moneyAmount = z.preprocess(
  toNumber,
  z
    .number({ required_error: "Enter an amount", invalid_type_error: "Enter a valid amount" })
    .refine((v) => Number.isFinite(v), "Enter a valid amount")
    .refine((v) => v > 0, "Amount must be greater than 0")
    .refine((v) => v <= MAX_MONEY, "Amount is too large")
    .refine(hasAtMostTwoDecimals, "Use at most 2 decimal places")
    .transform((v) => fromMinor(toMinor(v)))
);

/** Signed money (balances, opening positions). Zero allowed. */
export const signedMoney = z.preprocess(
  toNumber,
  z
    .number({ invalid_type_error: "Enter a valid amount" })
    .refine((v) => Number.isFinite(v), "Enter a valid amount")
    .refine((v) => Math.abs(v) <= MAX_MONEY, "Amount is too large")
    .refine(hasAtMostTwoDecimals, "Use at most 2 decimal places")
    .transform((v) => fromMinor(toMinor(v)))
);

/** Non-negative money (e.g. "already saved"). */
export const nonNegativeMoney = z.preprocess(
  toNumber,
  z
    .number({ invalid_type_error: "Enter a valid amount" })
    .refine((v) => Number.isFinite(v) && v >= 0, "Amount cannot be negative")
    .refine((v) => v <= MAX_MONEY, "Amount is too large")
    .refine(hasAtMostTwoDecimals, "Use at most 2 decimal places")
    .transform((v) => fromMinor(toMinor(v)))
);

export function idField(message = "Invalid id") {
  return z.string({ required_error: message, invalid_type_error: message }).cuid(message);
}

/** An id that may be cleared: "" and null → null. */
export function nullableIdField(message = "Invalid id") {
  return z.preprocess((v) => (v === "" ? null : v), idField(message).nullable());
}

/** Trimmed text; "" and whitespace → null. */
export function nullableText(max: number, label = "This field") {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max, `${label} must be at most ${max} characters`).nullable()
  );
}

export function requiredText(max: number, label: string, min = 1) {
  return z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
}

/** Calendar date "YYYY-MM-DD" (ISO date-times are truncated to their date). */
export const isoDate = z.preprocess(
  (v) => (typeof v === "string" || v instanceof Date ? coerceISODate(v) ?? v : v),
  z
    .string({ required_error: "Select a date", invalid_type_error: "Select a date" })
    .refine((v) => isValidISODate(v), "Enter a valid date")
) as unknown as z.ZodType<ISODate, z.ZodTypeDef, unknown>;

/** Optional calendar date: "" and null → null. Never becomes 1970-01-01. */
export const nullableIsoDate = z.preprocess(
  (v) => (v === "" ? null : v),
  isoDate.nullable()
) as unknown as z.ZodType<ISODate | null, z.ZodTypeDef, unknown>;

export const tagList = z
  .array(z.string().trim().min(1).max(40, "Tags must be at most 40 characters"))
  .max(20, "At most 20 tags")
  .transform((tags) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of tags) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
    return out;
  });

export const recordVersion = z.coerce
  .number({ invalid_type_error: "Missing record version" })
  .int()
  .positive("Missing record version");

export const pageParam = z.coerce.number().int().min(1).max(100_000).default(1);

export function pageSizeParam(options: readonly number[] = [20, 50, 100], fallback = 20) {
  return z.coerce
    .number()
    .int()
    .refine((v) => options.includes(v), `Page size must be one of ${options.join(", ")}`)
    .default(fallback);
}

/** Query-string boolean ("true"/"1"). */
export const queryBoolean = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");
