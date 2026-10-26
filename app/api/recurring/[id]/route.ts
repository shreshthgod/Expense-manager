import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { recurringUpdateSchema } from "@/lib/validation/schemas";
import { deleteRecurring, getRecurring, updateRecurring } from "@/server/services/recurring.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getRecurring(userId, params.id)));

/** Applies to this and future occurrences; recorded history is never changed. */
export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = recurringUpdateSchema.parse(await readJson(request));
  return ok(await updateRecurring(userId, params.id, input), "Saved — applies to upcoming occurrences");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteRecurring(userId, params.id);
  return ok({ deleted: true }, "Deleted. Transactions already recorded were kept.");
});
