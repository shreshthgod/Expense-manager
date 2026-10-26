import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { listConversations } from "@/server/services/chat.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listConversations(userId)));
