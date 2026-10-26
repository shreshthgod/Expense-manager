import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { requestMeta } from "@/lib/api/request";
import { clearSessionCookie } from "@/lib/auth/session";
import { audit } from "@/server/services/audit.service";
import { revokeSession } from "@/server/services/session.service";

export const runtime = "nodejs";

/** Revokes the current session server-side (a copied cookie stops working too). */
export const POST = withAuth(async ({ request, userId, sessionId }) => {
  await revokeSession(userId, sessionId);
  clearSessionCookie();
  await audit({ userId, action: "LOGOUT", entity: "Session", entityId: sessionId, ...requestMeta(request) });
  return ok({ loggedOut: true }, "Signed out");
});
