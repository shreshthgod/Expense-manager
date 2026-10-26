import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getDuplicateDraft } from "@/server/services/transaction.service";

export const runtime = "nodejs";

/** Returns an editable draft; nothing is saved until the user confirms the form. */
export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getDuplicateDraft(userId, params.id)));
