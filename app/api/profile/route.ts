import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { profileUpdateSchema } from "@/lib/validation/schemas";
import { getProfile, updateProfile } from "@/server/services/user.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await getProfile(userId)));

export const PATCH = withAuth(async ({ request, userId }) => {
  const input = profileUpdateSchema.parse(await readJson(request));
  return ok(await updateProfile(userId, input), "Profile updated");
});
