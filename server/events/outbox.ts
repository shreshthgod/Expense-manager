import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/observability/logger";
import type { TxClient } from "@/server/db/idempotency";
import type { ISODate } from "@/lib/dates/date-only";

/**
 * Transactional outbox for domain side effects (notifications, evaluations).
 *
 * Money effects are committed inside the business transaction; follow-up work
 * is enqueued as an OutboxEvent row in that SAME transaction, so it can never
 * be lost or run for a rolled-back change. After commit the caller dispatches
 * the events immediately; anything left over (crash, provider outage) is
 * retried by the scheduler with exponential backoff. Handlers are idempotent.
 */

export interface TransactionsChangedPayload {
  reason: "created" | "updated" | "deleted" | "restored" | "posted" | "imported" | "recurring";
  transactionIds: string[];
  /** Calendar dates touched (old and new) — drives budget-cycle re-evaluation. */
  dates: ISODate[];
  categoryIds: string[];
  accountIds: string[];
  /** Expenses that should be screened for anomalies. */
  newExpenseIds: string[];
}

export interface DomainEvents {
  "transactions.changed": TransactionsChangedPayload;
  "report.generated": { reportId: string; title: string };
  "import.completed": { importJobId: string; imported: number; skipped: number; failed: number };
  "goal.changed": { goalId: string };
}

export type DomainEventType = keyof DomainEvents;

const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60 * 1000;

export async function enqueueEvent<K extends DomainEventType>(
  tx: TxClient,
  userId: string,
  type: K,
  payload: DomainEvents[K]
): Promise<string> {
  const row = await tx.outboxEvent.create({
    data: { userId, type, payload: payload as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });
  return row.id;
}

type Handler = (userId: string, payload: unknown) => Promise<void>;

async function loadHandlers(): Promise<Record<string, Handler>> {
  // Imported lazily: handlers depend on services that themselves enqueue events.
  const mod = await import("./handlers");
  return mod.handlers as Record<string, Handler>;
}

interface ClaimedEvent {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  attempts: number;
}

async function claim(ids: string[] | null, limit: number): Promise<ClaimedEvent[]> {
  const leaseUntil = new Date(Date.now() + LEASE_MS);
  const idFilter = ids ? Prisma.sql`AND "id" IN (${Prisma.join(ids)})` : Prisma.empty;
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE "OutboxEvent" SET "attempts" = "attempts" + 1, "availableAt" = ${leaseUntil}
    WHERE "id" IN (
      SELECT "id" FROM "OutboxEvent"
      WHERE "status" = 'PENDING' AND "availableAt" <= NOW() ${idFilter}
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "userId", "type", "payload", "attempts"`;
}

async function runClaimed(events: ClaimedEvent[]): Promise<{ processed: number; failed: number }> {
  if (events.length === 0) return { processed: 0, failed: 0 };
  const handlers = await loadHandlers();
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    const handler = handlers[event.type];
    try {
      if (!handler) throw new Error(`No handler for event type ${event.type}`);
      await handler(event.userId, event.payload);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "DONE", processedAt: new Date(), lastError: null },
      });
      processed += 1;
    } catch (error) {
      failed += 1;
      const terminal = event.attempts >= MAX_ATTEMPTS;
      const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** (event.attempts - 1));
      logger.error("outbox.handler_failed", { eventId: event.id, type: event.type, attempts: event.attempts, error });
      await prisma.outboxEvent
        .update({
          where: { id: event.id },
          data: {
            status: terminal ? "FAILED" : "PENDING",
            availableAt: new Date(Date.now() + backoffMs),
            lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
  }
  return { processed, failed };
}

/** Best-effort immediate processing after a commit. Never throws. */
export async function dispatchEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await runClaimed(await claim(ids, ids.length));
  } catch (error) {
    logger.error("outbox.dispatch_failed", { error });
  }
}

/** Scheduler entry point: drains due events. */
export async function processPendingEvents(limit = 200): Promise<{ processed: number; failed: number }> {
  return runClaimed(await claim(null, limit));
}

export async function purgeProcessedEvents(olderThanDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.outboxEvent.deleteMany({ where: { status: "DONE", processedAt: { lt: cutoff } } });
  return result.count;
}
