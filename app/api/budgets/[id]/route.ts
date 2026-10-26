import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { budgetUpdateSchema } from "@/lib/validation/schemas";
import { deleteBudget, getBudgetStatus, updateBudget } from "@/server/services/budget.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getBudgetStatus(userId, params.id)));

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = budgetUpdateSchema.parse(await readJson(request));
  return ok(await updateBudget(userId, params.id, input), "Budget updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteBudget(userId, params.id);
  return ok({ deleted: true }, "Budget deleted");
});
