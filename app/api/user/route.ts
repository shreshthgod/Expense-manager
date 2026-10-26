import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { requestMeta } from "@/lib/api/request";
import { deleteUserSchema } from "@/lib/validation/schemas";
import { clearSessionCookie } from "@/lib/auth/session";
import { deleteUser, getProfile } from "@/server/services/user.service";
import { getPreferences } from "@/server/services/preference.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => {
  const [profile, preferences] = await Promise.all([getProfile(userId), getPreferences(userId)]);
  return ok({ ...profile, preferences });
});

/** Permanent deletion: requires the password and the typed confirmation. */
export const DELETE = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`delete-user:${userId}`, 5, 15 * 60_000);
  const input = deleteUserSchema.parse(await readJson(request));
  await deleteUser(userId, input.password, requestMeta(request));
  clearSessionCookie();
  return ok({ deleted: true }, "Your account and all of its data have been permanently deleted");
});
