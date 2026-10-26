import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { importConfirmSchema } from "@/lib/validation/schemas";
import { confirmImport } from "@/server/services/import.service";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Step 2: commit the user's decisions. Safe to retry — rows are unique per job. */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = importConfirmSchema.parse(await readJson(request, 4 * 1024 * 1024));
  const job = await confirmImport(userId, params.id, input.decisions);
  return ok(job, `Imported ${job.importedCount} transaction(s)`);
});
