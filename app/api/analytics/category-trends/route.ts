import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { trailingMonths } from "@/server/analytics/ranges";
import { getCategoryTrends } from "@/server/analytics/structure";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

const query = z.object({ months: z.coerce.number().int().min(2).max(24).default(6), limit: z.coerce.number().int().min(1).max(30).default(8) });

export const GET = withAuth(async ({ request, userId }) => {
  const q = query.parse(searchParamsObject(request));
  const settings = await getUserSettings(userId);
  const ranges = trailingMonths(todayFor(settings), q.months, settings);
  const windows = ranges.map((range) => ({ key: range.start, range }));
  return ok({ months: windows.map((w) => ({ key: w.key, ...w.range })), items: await getCategoryTrends(userId, windows, q.limit) });
});
