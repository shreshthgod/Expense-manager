import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { accountAdjustmentSchema } from "@/lib/validation/schemas";
import { adjustAccountBalance } from "@/server/services/account.service";

export const runtime = "nodejs";

/** Correction flow: records a dated ADJUSTMENT; never rewrites history. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = accountAdjustmentSchema.parse(await readJson(request));
  const result = await adjustAccountBalance(userId, params.id, input, {
    idempotency: idempotencyFrom(request, `accounts.adjust:${params.id}`, input),
  });
  return result.adjusted ? created(result, "Balance adjustment recorded") : ok(result, "The balance already matches — nothing to adjust");
});
