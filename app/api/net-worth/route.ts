import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getBalanceSummary } from "@/server/services/account.service";
import { getNetWorthHistory } from "@/server/services/planning.service";

export const runtime = "nodejs";

const query = z.object({ months: z.coerce.number().int().min(2).max(60).default(12) });

export const GET = withAuth(async ({ request, userId }) => {
  const { months } = query.parse(searchParamsObject(request));
  const [summary, history] = await Promise.all([getBalanceSummary(userId), getNetWorthHistory(userId, months)]);
  return ok({ summary, ...history });
});
