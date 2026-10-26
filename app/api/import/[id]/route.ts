import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getImportJob } from "@/server/services/import.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getImportJob(userId, params.id)));
