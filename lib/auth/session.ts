import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/db/prisma";
import { SESSION_TTL_SECONDS, sessionCookieName, signSessionToken, verifySessionToken } from "@/lib/auth/jwt";
import { createSessionRecord, findLiveSession, type SessionMeta } from "@/server/services/session.service";

/**
 * Cookie ⇄ session glue for route handlers and server components.
 * A request is authenticated only when the signed cookie is valid AND the
 * referenced Session row is live — so logout, "sign out everywhere", password
 * change and account deletion take effect immediately, server-side.
 */

export interface SessionContext {
  userId: string;
  sessionId: string;
}

export async function startSession(userId: string, meta: SessionMeta = {}): Promise<SessionContext> {
  const session = await createSessionRecord(userId, meta);
  const token = await signSessionToken({ userId, sessionId: session.id });
  cookies().set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
  return { userId, sessionId: session.id };
}

export function clearSessionCookie(): void {
  cookies().set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

/** Per-request cached session lookup. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const token = cookies().get(sessionCookieName())?.value;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const live = await findLiveSession(claims.userId, claims.sessionId);
  return live ? claims : null;
});

export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      onboardedAt: true,
      createdAt: true,
      profile: { select: { timezone: true, monthlyIncome: true } },
      preference: {
        select: {
          currency: true,
          dateFormat: true,
          theme: true,
          motion: true,
          weekStartsOn: true,
          monthStartDay: true,
          defaultAccountId: true,
          notifyBudget: true,
          notifyGoal: true,
          notifyAIInsight: true,
          notifyRecurring: true,
          notifyBills: true,
          notifyAnomalies: true,
        },
      },
    },
  });
  return user;
});

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
