import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { bulkActionSchema } from "@/lib/validation/schemas";
import { bulkUpdateTransactions } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Preview with `dryRun: true`, then commit. Each skipped row reports why. */
export const POST = withAuth(async ({ request, userId }) => {
  const input = bulkActionSchema.parse(await readJson(request));
  const result = await bulkUpdateTransactions(userId, input);
  return ok(result, input.dryRun ? "Preview ready" : `${result.processed} transaction(s) updated`);
});
