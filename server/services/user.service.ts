import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { audit, auditTx } from "@/server/services/audit.service";
import { ensureSystemCategories } from "@/server/services/category.service";
import { revokeAllSessions } from "@/server/services/session.service";
import type { SessionMeta } from "@/server/services/session.service";

/** Hash compared when the email is unknown, so both failure paths cost one
 * bcrypt comparison (no account enumeration by timing). */
let dummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(`timing-equaliser-${Math.random()}`);
  return dummyHash;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  onboardedAt: string | null;
}

function toPublic(u: { id: string; name: string; email: string; onboardedAt: Date | null }): PublicUser {
  return { id: u.id, name: u.name, email: u.email, onboardedAt: u.onboardedAt?.toISOString() ?? null };
}

export async function registerUser(input: { name: string; email: string; password: string }, meta: SessionMeta = {}): Promise<PublicUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          preference: { create: {} },
          profile: { create: {} },
        },
      });
      // Every user starts with their own default categories (DB ids are the
      // runtime source of truth for every category picker).
      await ensureSystemCategories(created.id, tx);
      await auditTx(tx, { userId: created.id, action: "USER_REGISTERED", entity: "User", entityId: created.id, ...meta });
      return created;
    });
    return toPublic(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.validation([{ path: ["email"], message: "An account with this email already exists" }]);
    }
    throw error;
  }
}

export async function authenticate(email: string, password: string, meta: SessionMeta = {}): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    if (user) await audit({ userId: user.id, action: "LOGIN_FAILED", entity: "User", entityId: user.id, ...meta });
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  await audit({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id, ...meta });
  return toPublic(user);
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  input: { currentPassword: string; newPassword: string; signOutOtherSessions: boolean },
  meta: SessionMeta = {}
): Promise<{ revokedSessions: number }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.unauthorized();
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw ApiError.validation([{ path: ["currentPassword"], message: "Current password is incorrect" }]);
  }
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    throw ApiError.validation([{ path: ["newPassword"], message: "Choose a password you haven't used for this account" }]);
  }
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
  const revokedSessions = input.signOutOtherSessions ? await revokeAllSessions(userId, currentSessionId) : 0;
  await audit({ userId, action: "PASSWORD_CHANGED", entity: "User", entityId: userId, metadata: { revokedSessions }, ...meta });
  return { revokedSessions };
}

/**
 * Permanent deletion with re-authentication. Every owned record cascades.
 * The audit trail keeps only a salted hash of the id — no personal data.
 */
export async function deleteUser(userId: string, password: string, meta: SessionMeta = {}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.unauthorized();
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.validation([{ path: ["password"], message: "Password is incorrect" }]);
  }
  const subject = createHash("sha256").update(`deleted-user:${userId}`).digest("hex").slice(0, 32);
  await prisma.$transaction(async (tx) => {
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.delete({ where: { id: userId } });
    await auditTx(tx, { userId: null, action: "USER_ACCOUNT_DELETED", entity: "User", entityId: subject, ...meta });
  });
}

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      onboardedAt: true,
      createdAt: true,
      profile: { select: { monthlyIncome: true, occupation: true, timezone: true } },
    },
  });
  if (!user) throw ApiError.unauthorized();
  return {
    ...user,
    onboardedAt: user.onboardedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    profile: user.profile
      ? { ...user.profile, monthlyIncome: user.profile.monthlyIncome != null ? Number(user.profile.monthlyIncome) : null }
      : null,
  };
}

export async function updateProfile(userId: string, input: { name?: string; avatarUrl?: string | null }) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  await audit({ userId, action: "PROFILE_UPDATED", entity: "User", entityId: userId });
  return user;
}
