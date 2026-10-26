import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";

/**
 * Notification producer + inbox. Producers call `notify()`; it
 *  1. honours the user's notification preferences, and
 *  2. deduplicates on a unique (userId, dedupeKey) — an event notifies once,
 *     whether or not an earlier copy was read (v1 re-fired after reading).
 */

type PreferenceFlag =
  | "notifyBudget"
  | "notifyGoal"
  | "notifyAIInsight"
  | "notifyRecurring"
  | "notifyBills"
  | "notifyAnomalies";

/** Which preference switch governs each notification type (null = always on). */
export const PREFERENCE_FOR_TYPE: Record<string, PreferenceFlag | null> = {
  BUDGET_THRESHOLD: "notifyBudget",
  BUDGET_EXCEEDED: "notifyBudget",
  GOAL_DEADLINE: "notifyGoal",
  GOAL_MILESTONE: "notifyGoal",
  UNUSUAL_TRANSACTION: "notifyAnomalies",
  RECURRING_UPCOMING: "notifyRecurring",
  RECURRING_FAILED: "notifyRecurring",
  BILL_DUE: "notifyBills",
  SUBSCRIPTION_RENEWAL: "notifyBills",
  AI_RECOMMENDATION: "notifyAIInsight",
  REPORT_GENERATED: null,
  IMPORT_COMPLETED: null,
};

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}

export type NotifyOutcome = "created" | "duplicate" | "muted";

export async function notify(input: NotifyInput): Promise<NotifyOutcome> {
  const flag = PREFERENCE_FOR_TYPE[input.type] ?? null;
  if (flag) {
    const pref = await prisma.userPreference.findUnique({ where: { userId: input.userId }, select: { [flag]: true } });
    if (pref && (pref as Record<string, boolean>)[flag] === false) return "muted";
  }
  const result = await prisma.notification.createMany({
    data: [
      {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 160),
        message: input.message.slice(0, 600),
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    ],
    skipDuplicates: true,
  });
  return result.count > 0 ? "created" : "duplicate";
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

function toDTO(n: { id: string; type: NotificationType; title: string; message: string; read: boolean; link: string | null; createdAt: Date }): NotificationDTO {
  return { id: n.id, type: n.type, title: n.title, message: n.message, read: n.read, link: n.link, createdAt: n.createdAt.toISOString() };
}

export async function listNotifications(userId: string, q: { page: number; pageSize: number; unreadOnly?: boolean }) {
  const where = { userId, ...(q.unreadOnly ? { read: false } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return {
    items: items.map(toDTO),
    total,
    unreadCount,
    page: q.page,
    pageSize: q.pageSize,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export async function setNotificationRead(userId: string, id: string, read: boolean): Promise<NotificationDTO> {
  const result = await prisma.notification.updateMany({ where: { id, userId }, data: { read } });
  if (result.count === 0) throw ApiError.notFound("Notification not found");
  const row = await prisma.notification.findFirstOrThrow({ where: { id, userId } });
  return toDTO(row);
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  return result.count;
}

export async function deleteNotification(userId: string, id: string): Promise<void> {
  const result = await prisma.notification.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw ApiError.notFound("Notification not found");
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}
