import { created, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { refundCreateSchema } from "@/lib/validation/schemas";
import { createRefund } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Full or partial refund linked to the original purchase. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = refundCreateSchema.parse(await readJson(request));
  const { transaction } = await createRefund(userId, params.id, input, {
    idempotency: idempotencyFrom(request, `transactions.refund:${params.id}`, input),
  });
  return created(transaction, "Refund recorded");
});
