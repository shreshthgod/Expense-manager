import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestMeta } from "@/lib/api/request";
import { changePasswordSchema } from "@/lib/validation/schemas";
import { changePassword } from "@/server/services/user.service";

export const runtime = "nodejs";

export const POST = withAuth(async ({ request, userId, sessionId }) => {
  await enforceRateLimit(`password:${userId}`, 10, 15 * 60_000);
  const input = changePasswordSchema.parse(await readJson(request));
  const result = await changePassword(userId, sessionId, input, requestMeta(request));
  return ok(
    result,
    result.revokedSessions > 0 ? `Password changed. Signed out ${result.revokedSessions} other session(s).` : "Password changed"
  );
});
