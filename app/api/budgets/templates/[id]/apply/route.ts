import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { budgetTemplateApplySchema } from "@/lib/validation/schemas";
import { applyBudgetTemplate } from "@/server/services/budget-template.service";

export const runtime = "nodejs";

/** dryRun: true returns the plan (create / replace / skip per item) without writing. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = budgetTemplateApplySchema.parse(await readJson(request));
  const result = await applyBudgetTemplate(userId, params.id, input);
  return ok(result, result.applied ? `${result.created + result.replaced} budget(s) created` : undefined);
});
