import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { transactionCreateSchema, transactionQuerySchema } from "@/lib/validation/schemas";
import { createTransaction, listTransactions } from "@/server/services/transaction.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const query = transactionQuerySchema.parse(searchParamsObject(request));
  return ok(await listTransactions(userId, query));
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = transactionCreateSchema.parse(await readJson(request));
  const { transaction, warnings } = await createTransaction(userId, input, {
    idempotency: idempotencyFrom(request, "transactions.create", input),
  });
  return created({ ...transaction, warnings }, transaction.status === "PLANNED" ? "Planned transaction saved" : "Transaction saved");
});
