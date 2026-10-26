import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { addDays, diffDays } from "@/lib/dates/date-only";
import { isoDate } from "@/lib/validation/schemas";
import { listScheduledItems } from "@/server/services/recurring.service";

export const runtime = "nodejs";

const scheduleQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from && diffDays(v.from, v.to) <= 400, { message: "Choose a range of at most 400 days", path: ["to"] });

/** Scheduled occurrences (inclusive `to`), deduplicated per rule and date. */
export const GET = withAuth(async ({ request, userId }) => {
  const q = scheduleQuery.parse(searchParamsObject(request));
  return ok(await listScheduledItems(userId, q.from, addDays(q.to, 1)));
});
