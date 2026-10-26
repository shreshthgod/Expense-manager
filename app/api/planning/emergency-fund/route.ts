import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getEmergencyFund } from "@/server/services/planning.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await getEmergencyFund(userId)));
