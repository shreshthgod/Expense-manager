import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { listTags } from "@/server/services/transaction.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listTags(userId)));
