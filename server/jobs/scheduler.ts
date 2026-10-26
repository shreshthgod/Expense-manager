import { logger } from "@/lib/observability/logger";
import { purgeRateLimitBuckets } from "@/lib/api/rate-limit";
import { purgeIdempotencyRecords } from "@/server/db/idempotency";
import { processPendingEvents, purgeProcessedEvents } from "@/server/events/outbox";
import { processRecurring, type ProcessSummary } from "@/server/services/recurring.service";
import { checkAllGoals, checkGoals } from "@/server/services/goal-deadlines.service";
import { purgeExpiredSessions } from "@/server/services/session.service";
import { captureDueSnapshots } from "@/server/services/review.service";

/**
 * Scheduled work. Invoked by:
 *  - POST /api/cron/run      (all users; authenticated with CRON_SECRET)
 *  - POST /api/system/sync   (current user only; the app calls it on load, throttled)
 *  - npm run cron            (local development / container cron)
 * Every step is idempotent, so overlapping or repeated runs are safe.
 */

export interface SchedulerSummary {
  recurring: ProcessSummary;
  goalNotifications: number;
  snapshots: number;
  outbox: { processed: number; failed: number };
  housekeeping?: { sessions: number; idempotency: number; events: number; rateLimits: number };
  startedAt: string;
  durationMs: number;
  errors: string[];
}

export async function runScheduledJobs(opts: { userId?: string; housekeeping?: boolean } = {}): Promise<SchedulerSummary> {
  const started = Date.now();
  const errors: string[] = [];
  const step = async <T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      errors.push(name);
      logger.error("scheduler.step_failed", { step: name, error });
      return fallback;
    }
  };

  const recurring = await step("recurring", { rulesProcessed: 0, transactionsCreated: 0, occurrencesDue: 0, failures: 0, reminders: 0 }, () =>
    processRecurring({ userId: opts.userId })
  );
  const goalNotifications = await step("goals", 0, () => (opts.userId ? checkGoals(opts.userId) : checkAllGoals()));
  const snapshots = await step("snapshots", 0, () => captureDueSnapshots(opts.userId));
  const outbox = await step("outbox", { processed: 0, failed: 0 }, () => processPendingEvents());

  let housekeeping: SchedulerSummary["housekeeping"];
  if (opts.housekeeping) {
    housekeeping = {
      sessions: await step("sessions", 0, () => purgeExpiredSessions()),
      idempotency: await step("idempotency", 0, () => purgeIdempotencyRecords()),
      events: await step("events", 0, () => purgeProcessedEvents()),
      rateLimits: await step("rateLimits", 0, () => purgeRateLimitBuckets()),
    };
  }

  const summary: SchedulerSummary = {
    recurring,
    goalNotifications,
    snapshots,
    outbox,
    housekeeping,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    errors,
  };
  logger.info("scheduler.run", { scope: opts.userId ? "user" : "all", ...summary });
  return summary;
}
