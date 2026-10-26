import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { analyticsRangeSchema } from "@/lib/validation/schemas";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getSpendingHeatmap } from "@/server/analytics/structure";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = analyticsRangeSchema.parse({ preset: "3_months", ...searchParamsObject(request) });
  const settings = await getUserSettings(userId);
  const period = resolvePeriod(q.preset, todayFor(settings), settings, q);
  return ok({ period: { label: period.label, ...period.range }, ...(await getSpendingHeatmap(userId, period.range)) });
});
