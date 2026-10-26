import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { affordabilitySchema } from "@/lib/validation/schemas";
import { evaluateAffordability } from "@/server/analytics/affordability";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

/** Deterministic affordability check (no model involved). */
export const POST = withAuth(async ({ request, userId }) => {
  const input = affordabilitySchema.parse(await readJson(request));
  const settings = await getUserSettings(userId);
  return ok(await evaluateAffordability(userId, input.amount, todayFor(settings), settings));
});
