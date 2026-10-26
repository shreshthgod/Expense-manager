import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { undoImport } from "@/server/services/import.service";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(async ({ userId, params }) => {
  const result = await undoImport(userId, params.id);
  return ok(result, `Removed ${result.deleted} imported transaction(s)`);
});
