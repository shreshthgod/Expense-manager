import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { explainTransaction } from "@/server/services/insight.service";

export const runtime = "nodejs";

/** Deterministic context for one transaction (typical amounts, merchant history). */
export const GET = withAuth<{ id: string }>(async ({ userId, params }) => {
  const result = await explainTransaction(userId, params.id);
  if (!result) throw ApiError.notFound("Transaction not found");
  return ok(result);
});
