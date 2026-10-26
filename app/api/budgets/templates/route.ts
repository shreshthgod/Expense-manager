import { z } from "zod";
import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { budgetTemplateSchema } from "@/lib/validation/schemas";
import { createBudgetTemplate, listBudgetTemplates, templateFromCurrentBudgets } from "@/server/services/budget-template.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listBudgetTemplates(userId)));

const fromCurrent = z.object({ fromCurrent: z.literal(true), name: z.string().trim().min(1, "Template name is required").max(60) });

/** Create from explicit items, or `{ fromCurrent: true, name }` to capture the current budgets. */
export const POST = withAuth(async ({ request, userId }) => {
  const body = await readJson(request);
  const snapshot = fromCurrent.safeParse(body);
  if (snapshot.success) return created(await templateFromCurrentBudgets(userId, snapshot.data.name), "Template saved");
  return created(await createBudgetTemplate(userId, budgetTemplateSchema.parse(body)), "Template saved");
});
