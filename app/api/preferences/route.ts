import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { preferenceUpdateSchema } from "@/lib/validation/schemas";
import { getPreferences, updatePreferences } from "@/server/services/preference.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await getPreferences(userId)));

export const PATCH = withAuth(async ({ request, userId }) => {
  const input = preferenceUpdateSchema.parse(await readJson(request));
  return ok(await updatePreferences(userId, input), "Preferences saved");
});
