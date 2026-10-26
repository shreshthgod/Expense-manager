import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getSafeToSpend } from "@/server/services/planning.service";

export const runtime = "nodejs";

/** Safe to spend until the end of the financial month, with every line of the calculation. */
export const GET = withAuth(async ({ userId }) => ok(await getSafeToSpend(userId)));
