import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { listActiveSessions } from "@/server/services/session.service";
import { listSecurityActivity } from "@/server/services/audit.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId, sessionId }) => {
  const [sessions, activity] = await Promise.all([listActiveSessions(userId, sessionId), listSecurityActivity(userId)]);
  return ok({ sessions, activity });
});
