import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { isoDate, occurrenceUpdateSchema } from "@/lib/validation/schemas";
import { updateOccurrence } from "@/server/services/recurring.service";

export const runtime = "nodejs";

/** Skip / unskip / override the amount of ONE occurrence, or retry a failed one. */
export const PATCH = withAuth<{ id: string; date: string }>(async ({ request, userId, params }) => {
  const dueDate = isoDate.parse(params.date);
  const input = occurrenceUpdateSchema.parse(await readJson(request));
  return ok(await updateOccurrence(userId, params.id, dueDate, input), "Occurrence updated");
});
