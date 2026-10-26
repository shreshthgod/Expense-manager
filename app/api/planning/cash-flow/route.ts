import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { cashFlowQuerySchema } from "@/lib/validation/schemas";
import { getCashFlowProjection } from "@/server/services/planning.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = cashFlowQuerySchema.parse(searchParamsObject(request));
  return ok(await getCashFlowProjection(userId, { days: q.days, includeExpectedIncome: q.includeExpectedIncome ?? true }));
});
