import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { deleteReport, getReport } from "@/server/services/report.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getReport(userId, params.id)));

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteReport(userId, params.id);
  return ok({ deleted: true }, "Report deleted");
});
