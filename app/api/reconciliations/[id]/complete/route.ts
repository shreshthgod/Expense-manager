import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { reconciliationCompleteSchema } from "@/lib/validation/schemas";
import { completeReconciliation } from "@/server/services/reconciliation.service";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = reconciliationCompleteSchema.parse(await readJson(request));
  return ok(await completeReconciliation(userId, params.id, input), "Account reconciled");
});
