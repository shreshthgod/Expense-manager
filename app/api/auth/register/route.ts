import { created, readJson } from "@/lib/api/response";
import { withPublic } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestMeta } from "@/lib/api/request";
import { registerSchema } from "@/lib/validation/schemas";
import { startSession } from "@/lib/auth/session";
import { registerUser } from "@/server/services/user.service";

export const runtime = "nodejs";

export const POST = withPublic(async ({ request }) => {
  const meta = requestMeta(request);
  await enforceRateLimit(`register:ip:${meta.ipAddress ?? "unknown"}`, meta.ipAddress ? 10 : 60, 60 * 60_000);
  const input = registerSchema.parse(await readJson(request));
  const user = await registerUser(input, meta);
  await startSession(user.id, meta);
  return created(user, "Account created");
});
