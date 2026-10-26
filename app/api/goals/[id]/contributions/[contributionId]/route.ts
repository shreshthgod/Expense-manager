import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { deleteContribution } from "@/server/services/goal.service";

export const runtime = "nodejs";

export const DELETE = withAuth<{ id: string; contributionId: string }>(async ({ userId, params }) =>
  ok(await deleteContribution(userId, params.id, params.contributionId), "Contribution removed")
);
