import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { deleteMapping } from "@/server/services/import.service";

export const runtime = "nodejs";

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteMapping(userId, params.id);
  return ok({ deleted: true }, "Preset deleted");
});
