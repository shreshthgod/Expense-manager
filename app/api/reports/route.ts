import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { reportGenerateSchema } from "@/lib/validation/schemas";
import { generateReport, listReports } from "@/server/services/report.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listReports(userId)));

/** Deterministic dataset first; the narrative (AI or template) second. */
export const POST = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`reports:${userId}`, 10, 60_000);
  const input = reportGenerateSchema.parse(await readJson(request));
  return created(await generateReport(userId, input), "Report generated");
});
