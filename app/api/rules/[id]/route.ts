import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ruleCreateSchema } from "@/lib/validation/schemas";
import { deleteRule, updateRule } from "@/server/services/rules.service";

export const runtime = "nodejs";

const ruleUpdateSchema = ruleCreateSchema.innerType().partial();

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = ruleUpdateSchema.parse(await readJson(request));
  return ok(await updateRule(userId, params.id, input), "Rule updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteRule(userId, params.id);
  return ok({ deleted: true }, "Rule deleted");
});
