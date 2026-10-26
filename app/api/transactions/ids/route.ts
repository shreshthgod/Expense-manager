import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { transactionQuerySchema } from "@/lib/validation/schemas";
import { listMatchingIds } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Ids of every row matching the current filters ("select all matching"). */
export const GET = withAuth(async ({ request, userId }) => {
  const { page: _p, pageSize: _s, sortBy: _b, sortDir: _d, ...filters } = transactionQuerySchema.parse(searchParamsObject(request));
  return ok(await listMatchingIds(userId, filters));
});
