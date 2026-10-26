import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getAccountBalanceHistory } from "@/server/services/planning.service";

export const runtime = "nodejs";

const query = z.object({ days: z.coerce.number().int().min(7).max(730).default(90) });

/** Daily end-of-day balance (ledger-derived) for charts. */
export const GET = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const { days } = query.parse(searchParamsObject(request));
  return ok(await getAccountBalanceHistory(userId, params.id, days));
});
