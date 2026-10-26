/**
 * Minimal structured logger: one JSON object per line in production, readable
 * lines in development. Never pass passwords, tokens, cookies or full financial
 * payloads — `redact()` scrubs well-known sensitive keys defensively.
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = /pass(word)?|token|secret|cookie|authorization|api_?key/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(process.env.NODE_ENV !== "production" ? { stack: value.stack } : {}) };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  if (process.env.NODE_ENV === "test" && level !== "error" && !process.env.LOG_IN_TESTS) return;
  const record = { level, event, time: new Date().toISOString(), ...(fields ? (redact(fields) as object) : {}) };
  const line = process.env.NODE_ENV === "production" ? JSON.stringify(record) : `[${level}] ${event} ${fields ? JSON.stringify(redact(fields)) : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields),
};
