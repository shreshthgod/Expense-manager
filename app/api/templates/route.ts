import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { templateSchema } from "@/lib/validation/schemas";
import { createTemplate, listTemplates } from "@/server/services/template.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listTemplates(userId)));

export const POST = withAuth(async ({ request, userId }) => {
  const input = templateSchema.parse(await readJson(request));
  return created(await createTemplate(userId, input), "Favourite saved");
});
