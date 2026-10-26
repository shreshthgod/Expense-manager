import { z } from "zod";
import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { parseTransactionFilter } from "@/server/services/filter.service";

export const runtime = "nodejs";

const body = z.object({ text: z.string().trim().min(2, "Type what you're looking for").max(200) });

/**
 * Turns "food above 1000 last month" into a transactions filter. The parser is
 * deterministic; `matched: false` means the text is used as a plain search.
 */
export const POST = withAuth(async ({ request, userId }) => {
  const { text } = body.parse(await readJson(request));
  return ok(await parseTransactionFilter(userId, text));
});
