import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { goalUpdateSchema } from "@/lib/validation/schemas";
import { deleteGoal, updateGoal } from "@/server/services/goal.service";

export const runtime = "nodejs";

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = goalUpdateSchema.parse(await readJson(request));
  return ok(await updateGoal(userId, params.id, input), "Goal updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteGoal(userId, params.id);
  return ok({ deleted: true }, "Goal deleted");
});
