import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { isoDate } from "@/lib/validation/primitives";
import { explainMonth } from "@/server/services/planning-narrative.service";

export const runtime = "nodejs";

const query = z.object({ periodStart: isoDate.optional() });

/** Plain-language explanation of a month, built only from computed figures (basis is returned). */
export const GET = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`ai:explain:${userId}`, 10, 60_000);
  const { periodStart } = query.parse(searchParamsObject(request));
  return ok(await explainMonth(userId, periodStart));
});
