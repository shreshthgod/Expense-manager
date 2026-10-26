import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { goalContributionSchema } from "@/lib/validation/schemas";
import { contributeToGoal, listContributions } from "@/server/services/goal.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await listContributions(userId, params.id)));

/**
 * Adds money to (positive) or releases money from (negative) a goal.
 * mode "earmark" moves no money; mode "transfer" posts a linked TRANSFER.
 */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = goalContributionSchema.parse(await readJson(request));
  const goal = await contributeToGoal(userId, params.id, input, {
    idempotency: idempotencyFrom(request, `goals.contribute:${params.id}`, input),
  });
  return created(goal, input.amount > 0 ? "Contribution recorded" : "Amount released from goal");
});
