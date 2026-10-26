import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { cancelReconciliation, getReconciliation } from "@/server/services/reconciliation.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getReconciliation(userId, params.id)));

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await cancelReconciliation(userId, params.id);
  return ok({ deleted: true }, "Reconciliation discarded");
});
