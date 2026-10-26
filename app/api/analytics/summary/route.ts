import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { analyticsRangeSchema } from "@/lib/validation/schemas";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getFinancialSummary } from "@/server/analytics/summary";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = analyticsRangeSchema.parse(searchParamsObject(request));
  const settings = await getUserSettings(userId);
  const period = resolvePeriod(q.preset, todayFor(settings), settings, q);
  return ok(await getFinancialSummary(userId, period));
});
