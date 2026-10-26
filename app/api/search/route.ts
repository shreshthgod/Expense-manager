import { z } from "zod";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { globalSearch } from "@/server/services/search.service";

export const runtime = "nodejs";

const searchQuery = z.object({ q: z.string().trim().max(80).default("") });

export const GET = withAuth(async ({ request, userId }) => {
  const { q } = searchQuery.parse(searchParamsObject(request));
  return ok(await globalSearch(userId, q));
});
