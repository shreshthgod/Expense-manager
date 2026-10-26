import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { transactionPostSchema } from "@/lib/validation/schemas";
import { postTransaction } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** PLANNED → POSTED. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = transactionPostSchema.parse(await readJson(request));
  return ok(await postTransaction(userId, params.id, input), "Transaction posted");
});
