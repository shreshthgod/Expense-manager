import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { requestMeta } from "@/lib/api/request";
import { clearSessionCookie } from "@/lib/auth/session";
import { audit } from "@/server/services/audit.service";
import { revokeSession } from "@/server/services/session.service";

export const runtime = "nodejs";

export const DELETE = withAuth<{ id: string }>(async ({ request, userId, sessionId, params }) => {
  const revoked = await revokeSession(userId, params.id);
  if (!revoked) throw ApiError.notFound("Session not found");
  if (params.id === sessionId) clearSessionCookie();
  await audit({ userId, action: "SESSION_REVOKED", entity: "Session", entityId: params.id, ...requestMeta(request) });
  return ok({ revoked: true, current: params.id === sessionId }, "Session signed out");
});
