import { created, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { isoDate, occurrenceSettleSchema } from "@/lib/validation/schemas";
import { settleOccurrence } from "@/server/services/recurring.service";

export const runtime = "nodejs";

/**
 * Mark paid: create the payment transaction or link an existing one. Settles
 * exactly once (unique occurrence + unique transaction link + idempotency key).
 */
export const POST = withAuth<{ id: string; date: string }>(async ({ request, userId, params }) => {
  const dueDate = isoDate.parse(params.date);
  const input = occurrenceSettleSchema.parse(await readJson(request));
  const result = await settleOccurrence(userId, params.id, dueDate, input, {
    idempotency: idempotencyFrom(request, `recurring.settle:${params.id}:${dueDate}`, input),
  });
  return created(result, input.mode === "link" ? "Payment linked" : "Payment recorded");
});
