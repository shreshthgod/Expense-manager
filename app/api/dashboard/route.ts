import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getDashboardData } from "@/server/services/dashboard.service";

export const runtime = "nodejs";

const dashboardQuery = z.object({
  period: z.enum(["this_week", "this_month", "last_month", "this_year"]).default("this_month"),
});

/** Read-only: no recurring processing or notifications happen on this GET. */
export const GET = withAuth(async ({ request, userId }) => {
  const q = dashboardQuery.parse(searchParamsObject(request));
  return ok(await getDashboardData(userId, q.period));
});
