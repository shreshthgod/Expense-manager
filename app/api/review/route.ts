import { z } from "zod";
import { ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { isoDate } from "@/lib/validation/primitives";
import { reviewMarkSchema } from "@/lib/validation/schemas";
import { getMonthlyReview, markMonthReviewed } from "@/server/services/review.service";

export const runtime = "nodejs";

const query = z.object({ periodStart: isoDate.optional() });

/** The monthly review for a financial month (default: the last completed one). */
export const GET = withAuth(async ({ request, userId }) => {
  const { periodStart } = query.parse(searchParamsObject(request));
  return ok(await getMonthlyReview(userId, periodStart));
});

/** Marks the month reviewed and stores its snapshot. */
export const POST = withAuth(async ({ request, userId }) => {
  const input = reviewMarkSchema.parse(await readJson(request));
  return ok(await markMonthReviewed(userId, input), "Month marked as reviewed");
});
