import { ok, readJson } from "@/lib/api/response";
import { withPublic } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestMeta } from "@/lib/api/request";
import { loginSchema } from "@/lib/validation/schemas";
import { startSession } from "@/lib/auth/session";
import { authenticate } from "@/server/services/user.service";

export const runtime = "nodejs";

/**
 * Brute-force protection is keyed on BOTH the (trusted) client IP and the
 * target email, so an attacker can neither rotate spoofed IPs against one
 * account nor lock out everybody when the IP is unknown.
 */
export const POST = withPublic(async ({ request }) => {
  const meta = requestMeta(request);
  if (meta.ipAddress) await enforceRateLimit(`login:ip:${meta.ipAddress}`, 30, 60_000);
  const input = loginSchema.parse(await readJson(request));
  await enforceRateLimit(`login:email:${input.email}`, 10, 15 * 60_000);
  const user = await authenticate(input.email, input.password, meta);
  await startSession(user.id, meta);
  return ok(user, "Signed in");
});
