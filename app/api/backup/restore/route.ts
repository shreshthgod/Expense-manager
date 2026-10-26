import { z } from "zod";
import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { parseBackup, planRestore, restoreBackup } from "@/server/services/backup.service";

export const runtime = "nodejs";

const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

const body = z.object({
  mode: z.enum(["merge", "replace"]),
  dryRun: z.boolean().default(true),
  /** Replace deletes data: the client must send the exact confirmation phrase. */
  confirm: z.string().optional(),
  file: z.unknown(),
});

/** dryRun (default) validates and returns the plan; otherwise restores in one transaction. */
export const POST = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`backup:restore:${userId}`, 10, 60_000);
  const input = body.parse(await readJson(request, MAX_BACKUP_BYTES));
  const file = parseBackup(input.file);
  if (input.dryRun) return ok(await planRestore(userId, file, input.mode));
  if (input.mode === "replace" && input.confirm !== "REPLACE") {
    throw ApiError.field("confirm", 'Type REPLACE to confirm that your current data will be deleted');
  }
  const result = await restoreBackup(userId, file, input.mode);
  return ok(result, "Backup restored");
});
