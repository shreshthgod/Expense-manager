import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { importPreviewSchema } from "@/lib/validation/schemas";
import { listImportJobs, previewImport } from "@/server/services/import.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listImportJobs(userId)));

/** Step 1: validate + preview (no ledger changes). */
export const POST = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`import:${userId}`, 20, 60 * 60_000);
  const input = importPreviewSchema.parse(await readJson(request, 8 * 1024 * 1024));
  return created(await previewImport(userId, input), "Preview ready");
});
