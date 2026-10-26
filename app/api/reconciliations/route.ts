import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idField, reconciliationStartSchema } from "@/lib/validation/schemas";
import { listReconciliations, startReconciliation } from "@/server/services/reconciliation.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const accountId = searchParamsObject(request).accountId;
  return ok(await listReconciliations(userId, accountId ? idField().parse(accountId) : undefined));
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = reconciliationStartSchema.parse(await readJson(request));
  return created(await startReconciliation(userId, input), "Reconciliation started");
});
