import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ruleApplySchema } from "@/lib/validation/schemas";
import { applyRule } from "@/server/services/rules.service";

export const runtime = "nodejs";

/** Preview (dryRun, default) then apply a rule to existing transactions. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = ruleApplySchema.parse(await readJson(request));
  const result = await applyRule(userId, params.id, input);
  return ok(result, input.dryRun ? `${result.willChange} transaction(s) would change` : `${result.applied} transaction(s) updated`);
});
