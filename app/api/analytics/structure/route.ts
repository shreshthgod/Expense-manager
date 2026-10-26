import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { analyticsRangeSchema } from "@/lib/validation/schemas";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getSpendingStructure, getSpendingVelocity } from "@/server/analytics/structure";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

/** Essential vs discretionary, fixed vs variable, and spending velocity for a period. */
export const GET = withAuth(async ({ request, userId }) => {
  const q = analyticsRangeSchema.parse(searchParamsObject(request));
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  const period = resolvePeriod(q.preset, today, settings, q);
  const [current, previous, velocity] = await Promise.all([
    getSpendingStructure(userId, period.range),
    getSpendingStructure(userId, period.previous),
    getSpendingVelocity(userId, period.range, period.previous, today),
  ]);
  return ok({ period: { label: period.label, ...period.range }, current, previous, velocity });
});
