import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { categoryCreateSchema, categoryQuerySchema, queryBoolean } from "@/lib/validation/schemas";
import { createCategory, listCategories } from "@/server/services/category.service";

export const runtime = "nodejs";

/** Categories are per-user DB rows; clients must use these ids (never names). */
export const GET = withAuth(async ({ request, userId }) => {
  const raw = searchParamsObject(request);
  const q = categoryQuerySchema.parse(raw);
  const withUsage = raw.withUsage ? queryBoolean.parse(raw.withUsage) : false;
  return ok(await listCategories(userId, { includeArchived: q.includeArchived, type: q.type, withUsage }));
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = categoryCreateSchema.parse(await readJson(request));
  return created(await createCategory(userId, input), "Category created");
});
