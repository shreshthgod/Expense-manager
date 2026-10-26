import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { conversationUpdateSchema } from "@/lib/validation/schemas";
import { deleteConversation, getConversation, renameConversation } from "@/server/services/chat.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getConversation(userId, params.id)));

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = conversationUpdateSchema.parse(await readJson(request));
  const message = input.pinned === undefined ? "Conversation renamed" : input.pinned ? "Conversation pinned" : "Conversation unpinned";
  return ok(await renameConversation(userId, params.id, input.title, input.pinned), message);
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteConversation(userId, params.id);
  return ok({ deleted: true }, "Conversation deleted");
});
