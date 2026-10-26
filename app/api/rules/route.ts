import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ruleCreateSchema } from "@/lib/validation/schemas";
import { createRule, listRules } from "@/server/services/rules.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listRules(userId)));

export const POST = withAuth(async ({ request, userId }) => {
  const input = ruleCreateSchema.parse(await readJson(request));
  return created(await createRule(userId, input), "Rule created");
});
