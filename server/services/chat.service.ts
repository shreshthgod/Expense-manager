import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";

export interface ConversationDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  pinned: boolean;
}

export interface MessageDTO {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  createdAt: string;
  /** Assistant messages keep their structured evidence for re-display. */
  metadata: Record<string, unknown> | null;
}

function truncateTitle(seed: string): string {
  const clean = seed.replace(/\s+/g, " ").trim();
  return clean.length <= 60 ? clean : `${clean.slice(0, 57)}…`;
}

/** Ownership-checked: a foreign conversation id is simply "not found". */
export async function getOrCreateConversation(userId: string, conversationId?: string, titleSeed?: string) {
  if (conversationId) {
    const existing = await prisma.aIConversation.findFirst({ where: { id: conversationId, userId } });
    if (!existing) throw ApiError.notFound("Conversation not found");
    return existing;
  }
  return prisma.aIConversation.create({
    data: { userId, title: titleSeed ? truncateTitle(titleSeed) : "New conversation" },
  });
}

export async function appendMessage(params: {
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.$transaction([
    prisma.aIMessage.create({
      data: {
        conversationId: params.conversationId,
        role: params.role,
        content: params.content,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    }),
    prisma.aIConversation.update({ where: { id: params.conversationId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Recent turns used as conversational context (ownership enforced). */
export async function recentMessages(userId: string, conversationId: string, limit = 8): Promise<{ role: "USER" | "ASSISTANT"; content: string }[]> {
  const conversation = await prisma.aIConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } });
  if (!conversation) return [];
  const rows = await prisma.aIMessage.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map((r) => ({ role: r.role as "USER" | "ASSISTANT", content: r.content }));
}

export async function listConversations(userId: string): Promise<ConversationDTO[]> {
  const rows = await prisma.aIConversation.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 100,
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    messageCount: r._count.messages,
    lastMessage: r.messages[0]?.content.slice(0, 140) ?? null,
    pinned: r.pinned,
  }));
}

export async function getConversation(userId: string, conversationId: string): Promise<ConversationDTO & { messages: MessageDTO[] }> {
  const conversation = await prisma.aIConversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 400 }, _count: { select: { messages: true } } },
  });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: conversation._count.messages,
    lastMessage: conversation.messages.at(-1)?.content.slice(0, 140) ?? null,
    pinned: conversation.pinned,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      metadata: (m.metadata as Record<string, unknown> | null) ?? null,
    })),
  };
}

export async function renameConversation(userId: string, conversationId: string, title?: string, pinned?: boolean): Promise<ConversationDTO> {
  const updated = await prisma.aIConversation.updateMany({
    where: { id: conversationId, userId },
    data: { ...(title ? { title: truncateTitle(title) } : {}), ...(pinned !== undefined ? { pinned } : {}) },
  });
  if (updated.count === 0) throw ApiError.notFound("Conversation not found");
  const [dto] = (await listConversations(userId)).filter((c) => c.id === conversationId);
  return dto!;
}

export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const deleted = await prisma.aIConversation.deleteMany({ where: { id: conversationId, userId } });
  if (deleted.count === 0) throw ApiError.notFound("Conversation not found");
}

export async function hasEnoughDataForAI(userId: string): Promise<boolean> {
  const count = await prisma.transaction.count({ where: { userId, deletedAt: null, status: "POSTED" } });
  return count >= 3;
}
