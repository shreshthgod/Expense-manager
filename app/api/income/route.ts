import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { incomeCreateSchema, transactionQuerySchema } from "@/lib/validation/schemas";
import { createTransaction, listTransactions } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Income is the same transaction model with type fixed to INCOME. */
export const GET = withAuth(async ({ request, userId }) => {
  const query = transactionQuerySchema.parse(searchParamsObject(request));
  return ok(await listTransactions(userId, { ...query, type: "INCOME" }));
});

export const POST = withAuth(async ({ request, userId }) => {
  const raw = await readJson(request);
  const input = incomeCreateSchema.parse({ ...(raw && typeof raw === "object" ? raw : {}), type: "INCOME" });
  const { transaction } = await createTransaction(userId, input, {
    idempotency: idempotencyFrom(request, "transactions.create", input),
  });
  return created(transaction, "Income recorded");
});
