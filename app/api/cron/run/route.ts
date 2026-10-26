import { ok } from "@/lib/api/response";
import { withCron } from "@/lib/api/route";
import { runScheduledJobs } from "@/server/jobs/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scheduler entry point for all users. Authenticate with
 *   Authorization: Bearer $CRON_SECRET
 * Safe to call concurrently or repeatedly (idempotent occurrence keys,
 * SKIP LOCKED rule locks, deduplicated notifications).
 */
export const POST = withCron(async () => ok(await runScheduledJobs({ housekeeping: true })));
export const GET = POST;
