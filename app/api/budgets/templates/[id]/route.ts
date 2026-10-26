import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { deleteBudgetTemplate } from "@/server/services/budget-template.service";

export const runtime = "nodejs";

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteBudgetTemplate(userId, params.id);
  return ok({ deleted: true }, "Template deleted");
});
