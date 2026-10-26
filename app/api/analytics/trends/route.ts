import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { analyticsRangeSchema } from "@/lib/validation/schemas";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getDailyTrend, getMonthlyTrend, getWeeklyTrend } from "@/server/analytics/trends";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

const trendQuery = z.object({
  granularity: z.enum(["day", "week", "month"]).default("month"),
  months: z.coerce.number().int().min(1).max(24).default(6),
});

export const GET = withAuth(async ({ request, userId }) => {
  const raw = searchParamsObject(request);
  const t = trendQuery.parse(raw);
  const settings = await getUserSettings(userId);
  const today = todayFor(settings);
  if (t.granularity === "month") return ok(await getMonthlyTrend(userId, today, t.months, settings));
  const q = analyticsRangeSchema.parse(raw);
  const period = resolvePeriod(q.preset, today, settings, q);
  return ok(
    t.granularity === "day" ? await getDailyTrend(userId, period.range) : await getWeeklyTrend(userId, period.range, settings.weekStartsOn)
  );
});
