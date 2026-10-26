import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { aiChatSchema } from "@/lib/validation/schemas";
import { runAgentChat } from "@/agents/agent-runner";

export const runtime = "nodejs";

export const POST = withAuth(async ({ request, userId }) => {
  await enforceRateLimit(`ai:chat:${userId}`, 20, 60_000);
  const input = aiChatSchema.parse(await readJson(request));
  return ok(await runAgentChat({ userId, message: input.message, conversationId: input.conversationId }));
});
