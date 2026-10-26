import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";

/**
 * Rate limiting with two interchangeable stores:
 *  - memory (default): single instance, resets on restart
 *  - database (RATE_LIMIT_STORE=database): fixed-window counters in PostgreSQL,
 *    shared by every app instance — use this for multi-instance deployments.
 */

interface LimitStore {
  hit(key: string, windowMs: number): Promise<number>;
}

const memoryBuckets = new Map<string, number[]>();

const memoryStore: LimitStore = {
  async hit(key, windowMs) {
    const now = Date.now();
    const timestamps = (memoryBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    memoryBuckets.set(key, timestamps);
    if (memoryBuckets.size > 5_000) {
      for (const [k, v] of memoryBuckets) {
        if (v.every((t) => now - t >= windowMs)) memoryBuckets.delete(k);
      }
    }
    return timestamps.length;
  },
};

const databaseStore: LimitStore = {
  async hit(key, windowMs) {
    const now = Date.now();
    const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
    const expiresAt = new Date(windowStart.getTime() + windowMs);
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "windowStart", "count", "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart"
                       THEN "RateLimitBucket"."count" + 1 ELSE 1 END,
        "windowStart" = EXCLUDED."windowStart",
        "expiresAt" = EXCLUDED."expiresAt"
      RETURNING "count"`;
    return Number(rows[0]?.count ?? 1);
  },
};

function store(): LimitStore {
  return process.env.RATE_LIMIT_STORE === "database" ? databaseStore : memoryStore;
}

export async function enforceRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") return;
  const count = await store().hit(key, windowMs);
  if (count > limit) throw ApiError.tooManyRequests();
}

/** Scheduler housekeeping for the database store. */
export async function purgeRateLimitBuckets(): Promise<number> {
  const result = await prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}

/** Test helper. */
export function resetMemoryRateLimits(): void {
  memoryBuckets.clear();
}
