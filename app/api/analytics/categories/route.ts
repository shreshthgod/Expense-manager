import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { analyticsRangeSchema } from "@/lib/validation/schemas";
import { resolvePeriod } from "@/server/analytics/ranges";
import { getCategoryBreakdown } from "@/server/analytics/categories";
import { getUserSettings, todayFor } from "@/server/services/user-settings.service";

export const runtime = "nodejs";

const kindSchema = z.object({ kind: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE") });

export const GET = withAuth(async ({ request, userId }) => {
  const raw = searchParamsObject(request);
  const q = analyticsRangeSchema.parse(raw);
  const { kind } = kindSchema.parse(raw);
  const settings = await getUserSettings(userId);
  const period = resolvePeriod(q.preset, todayFor(settings), settings, q);
  const items = await getCategoryBreakdown(userId, period.range, period.previous, kind);
  return ok({ period: { label: period.label, ...period.range }, previous: period.previous, items });
});
