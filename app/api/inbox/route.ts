import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getInbox } from "@/server/services/inbox.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await getInbox(userId)));
