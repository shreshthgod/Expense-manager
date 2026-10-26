import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { runScheduledJobs } from "@/server/jobs/scheduler";

export const runtime = "nodejs";

/**
 * User-scoped catch-up of scheduled work (due recurring items, reminders,
 * pending side effects). The app calls this on load — as a POST, because it
 * can write — so deployments without a cron still stay current. Idempotent.
 */
export const POST = withAuth(async ({ userId }) => {
  try {
    await enforceRateLimit(`sync:${userId}`, 1, 60_000);
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return ok({ skipped: true }, "Recently synced");
    throw error;
  }
  const summary = await runScheduledJobs({ userId });
  return ok({ skipped: false, ...summary });
});
