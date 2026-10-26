import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { templateSchema } from "@/lib/validation/schemas";
import { deleteTemplate, updateTemplate } from "@/server/services/template.service";

export const runtime = "nodejs";

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = templateSchema.partial().parse(await readJson(request));
  return ok(await updateTemplate(userId, params.id, input), "Favourite updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteTemplate(userId, params.id);
  return ok({ deleted: true }, "Favourite removed");
});
