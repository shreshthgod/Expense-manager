import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { budgetCreateSchema } from "@/lib/validation/schemas";
import { createBudget, listBudgets } from "@/server/services/budget.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listBudgets(userId)));

export const POST = withAuth(async ({ request, userId }) => {
  const input = budgetCreateSchema.parse(await readJson(request));
  return created(await createBudget(userId, input, { idempotency: idempotencyFrom(request, "budgets.create", input) }), "Budget created");
});
