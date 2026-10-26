import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { importMappingSaveSchema } from "@/lib/validation/schemas";
import { listMappings, saveMapping } from "@/server/services/import.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listMappings(userId)));

export const POST = withAuth(async ({ request, userId }) => {
  const input = importMappingSaveSchema.parse(await readJson(request));
  return created(await saveMapping(userId, input), "Preset saved");
});
