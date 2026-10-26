import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";

export type TxClient = Prisma.TransactionClient;

/**
 * Exactly-once execution for retryable creates.
 *
 * The idempotency record is inserted in the SAME database transaction as the
 * business write. Consequences:
 *  - commit ⇒ record and effects exist together; a retry replays the stored body
 *  - rollback ⇒ neither exists; a retry executes normally
 *  - two concurrent requests with one key ⇒ the second blocks on the unique
 *    index, then fails and replays the first one's committed response
 *  - same key, different payload ⇒ IDEMPOTENCY_KEY_REUSED
 */
export interface IdempotencyContext {
  key: string;
  scope: string;
  requestHash: string;
  /** HTTP status recorded for replays (opaque to services). */
  successStatus: number;
}

export interface IdempotentResult<T> {
  value: T;
  replayed: boolean;
  status: number;
}

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_RE.test(key);
}

/** Deterministic JSON (sorted keys) so equal payloads hash equally. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashRequest(scope: string, payload: unknown): string {
  return createHash("sha256").update(scope).update("\n").update(stableStringify(payload)).digest("hex");
}

function isIdempotencyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = error.meta as { modelName?: string; target?: string[] | string } | undefined;
  if (meta?.modelName === "IdempotencyRecord") return true;
  const target = meta?.target;
  return Array.isArray(target) ? target.includes("key") : typeof target === "string" && target.includes("IdempotencyRecord");
}

async function replay<T>(userId: string, ctx: IdempotencyContext): Promise<IdempotentResult<T> | null> {
  const existing = await prisma.idempotencyRecord.findUnique({ where: { userId_key: { userId, key: ctx.key } } });
  if (!existing) return null;
  if (existing.requestHash !== ctx.requestHash || existing.scope !== ctx.scope) {
    throw ApiError.rule(
      "This request key was already used for a different request. Refresh and submit again.",
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  return { value: existing.responseBody as T, replayed: true, status: existing.responseStatus };
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export async function runInTransaction<T>(
  userId: string,
  idempotency: IdempotencyContext | undefined,
  work: (tx: TxClient) => Promise<T>
): Promise<IdempotentResult<T>> {
  if (!idempotency) {
    const value = await prisma.$transaction(work, TX_OPTIONS);
    return { value, replayed: false, status: 0 };
  }

  const earlier = await replay<T>(userId, idempotency);
  if (earlier) return earlier;

  try {
    const value = await prisma.$transaction(async (tx) => {
      const result = await work(tx);
      await tx.idempotencyRecord.create({
        data: {
          userId,
          key: idempotency.key,
          scope: idempotency.scope,
          requestHash: idempotency.requestHash,
          responseStatus: idempotency.successStatus,
          responseBody: JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue,
        },
      });
      return result;
    }, TX_OPTIONS);
    return { value, replayed: false, status: idempotency.successStatus };
  } catch (error) {
    if (isIdempotencyConflict(error)) {
      const concurrent = await replay<T>(userId, idempotency);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

/** Scheduler housekeeping: keys only need to outlive realistic client retries. */
export async function purgeIdempotencyRecords(olderThanHours = 72): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const result = await prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
