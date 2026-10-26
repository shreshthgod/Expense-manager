import { ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { queryBoolean, transactionDeleteSchema, transactionUpdateSchema } from "@/lib/validation/schemas";
import { deleteTransaction, getTransaction, updateTransaction } from "@/server/services/transaction.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const q = searchParamsObject(request);
  const includeDeleted = q.includeDeleted ? queryBoolean.parse(q.includeDeleted) : false;
  return ok(await getTransaction(userId, params.id, { includeDeleted }));
});

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = transactionUpdateSchema.parse(await readJson(request));
  return ok(await updateTransaction(userId, params.id, input), "Transaction updated");
});

/**
 * Soft delete (undo via POST /restore). `?version=` guards concurrent edits;
 * `?withRefunds=true` explicitly deletes the purchase's refunds too;
 * `?confirmReconciledChange=true` acknowledges reopening a reconciliation.
 */
export const DELETE = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const q = transactionDeleteSchema.parse(searchParamsObject(request));
  const result = await deleteTransaction(userId, params.id, {
    version: q.version,
    withRefunds: q.withRefunds,
    confirmReconciledChange: q.confirmReconciledChange,
  });
  return ok(result, result.deletedRefundIds.length ? `Transaction and ${result.deletedRefundIds.length} refund(s) deleted` : "Transaction deleted");
});
