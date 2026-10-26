import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getCardStatement } from "@/server/services/account.service";

export const runtime = "nodejs";

/** Credit-card statement balance, payments since and due date (from recorded data only). */
export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getCardStatement(userId, params.id)));
