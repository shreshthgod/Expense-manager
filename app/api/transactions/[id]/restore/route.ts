import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { restoreTransaction } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Undo delete: restores the row AND its balance effects atomically. */
export const POST = withAuth<{ id: string }>(async ({ userId, params }) => ok(await restoreTransaction(userId, params.id), "Transaction restored"));
