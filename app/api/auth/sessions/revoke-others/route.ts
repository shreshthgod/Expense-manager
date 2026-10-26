import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { requestMeta } from "@/lib/api/request";
import { audit } from "@/server/services/audit.service";
import { revokeAllSessions } from "@/server/services/session.service";

export const runtime = "nodejs";

export const POST = withAuth(async ({ request, userId, sessionId }) => {
  const count = await revokeAllSessions(userId, sessionId);
  await audit({ userId, action: "ALL_SESSIONS_REVOKED", entity: "Session", metadata: { count }, ...requestMeta(request) });
  return ok({ revoked: count }, count ? `Signed out ${count} other session(s)` : "No other sessions were active");
});
