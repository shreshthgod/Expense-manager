/**
 * Number grounding for AI prose. The AI may only restate numbers that were
 * computed deterministically; any other figure in its text means the output
 * is rejected and the template narrative is used instead.
 */

/** Every numeric token in a text (commas and currency symbols removed). */
export function numbersIn(text: string): number[] {
  const matches = text.replace(/₹/g, " ").match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** Collects all numbers (recursively) from a data payload. */
export function numbersFrom(data: unknown, out: number[] = []): number[] {
  if (typeof data === "number" && Number.isFinite(data)) out.push(data);
  else if (typeof data === "string") out.push(...numbersIn(data));
  else if (Array.isArray(data)) data.forEach((d) => numbersFrom(d, out));
  else if (data && typeof data === "object") Object.values(data).forEach((v) => numbersFrom(v, out));
  return out;
}

/**
 * True when every number in `text` matches an allowed value (exactly, after
 * rounding to whole units or 1 decimal, or as its absolute value). Small
 * integers ≤ 12 (counts, months) and years are always allowed.
 */
export function isGrounded(text: string, allowed: number[]): boolean {
  const pool = new Set<string>();
  for (const a of allowed) {
    for (const v of [a, Math.abs(a)]) {
      pool.add(v.toFixed(2));
      pool.add(Math.round(v).toFixed(2));
      pool.add((Math.round(v * 10) / 10).toFixed(2));
      pool.add(Math.floor(v).toFixed(2));
    }
  }
  return numbersIn(text).every((n) => {
    const abs = Math.abs(n);
    if (Number.isInteger(abs) && (abs <= 12 || (abs >= 1900 && abs <= 2200))) return true;
    return pool.has(abs.toFixed(2)) || pool.has(n.toFixed(2));
  });
}
