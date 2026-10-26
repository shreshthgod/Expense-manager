import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { goalCreateSchema, queryBoolean } from "@/lib/validation/schemas";
import { createGoal, listGoals } from "@/server/services/goal.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const raw = searchParamsObject(request).includeArchived;
  return ok(await listGoals(userId, undefined, { includeArchived: raw ? queryBoolean.parse(raw) : false }));
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = goalCreateSchema.parse(await readJson(request));
  return created(await createGoal(userId, input, { idempotency: idempotencyFrom(request, "goals.create", input) }), "Goal created");
});
