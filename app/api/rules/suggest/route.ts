import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { suggestionQuerySchema } from "@/lib/validation/schemas";
import { suggestFor } from "@/server/services/rules.service";

export const runtime = "nodejs";

/** Category suggestion for a draft: matching rule, then merchant history. Never applied automatically. */
export const GET = withAuth(async ({ request, userId }) => {
  const q = suggestionQuerySchema.parse(searchParamsObject(request));
  return ok(await suggestFor(userId, q));
});
