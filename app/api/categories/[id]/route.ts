import { ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { categoryDeleteSchema, categoryUpdateSchema } from "@/lib/validation/schemas";
import { deleteCategory, updateCategory } from "@/server/services/category.service";

export const runtime = "nodejs";

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = categoryUpdateSchema.parse(await readJson(request));
  return ok(await updateCategory(userId, params.id, input), "Category updated");
});

/** `?reassignTo=<categoryId>` moves referenced records first (one transaction). */
export const DELETE = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const { reassignToCategoryId } = categoryDeleteSchema.parse({ reassignToCategoryId: searchParamsObject(request).reassignTo });
  const result = await deleteCategory(userId, params.id, reassignToCategoryId);
  return ok({ deleted: true, ...result }, result.reassigned ? `Category deleted; ${result.reassigned} record(s) moved` : "Category deleted");
});
