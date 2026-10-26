import { SignJWT, jwtVerify } from "jose";

/**
 * Session token signing. Edge-safe (used by middleware.ts), so no Node or
 * Prisma imports here. The token only proves "this cookie was issued by us for
 * session `sid` of user `sub`"; revocation is checked against the Session table
 * by lib/auth/session.ts on every authenticated server request.
 */

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MIN_SECRET_LENGTH = 32;

/** Values that must never sign production tokens (published in docs/examples). */
const KNOWN_WEAK_SECRETS = new Set([
  "dev-only-secret-change-me-in-production-0123456789abcdef",
  "replace-with-a-long-random-secret",
  "changeme",
  "secret",
]);

const DEV_FALLBACK_SECRET = "insecure-local-development-secret-do-not-use-in-production-000000";

let warnedAboutDevSecret = false;

export class AuthConfigurationError extends Error {}

export function authSecretProblem(secret: string | undefined): string | null {
  if (!secret) return "AUTH_SECRET is not set";
  if (secret.length < MIN_SECRET_LENGTH) return `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
  if (KNOWN_WEAK_SECRETS.has(secret)) return "AUTH_SECRET is a publicly known example value";
  return null;
}

/** Fails closed in production when the secret is missing or weak. */
export function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  const problem = authSecretProblem(secret);
  if (problem) {
    if (process.env.NODE_ENV === "production") {
      throw new AuthConfigurationError(`${problem}. Refusing to sign or verify sessions.`);
    }
    if (!warnedAboutDevSecret) {
      warnedAboutDevSecret = true;
      console.warn(`[auth] ${problem}; using an insecure development-only secret.`);
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  userId: string;
  sessionId: string;
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (error) {
    if (error instanceof AuthConfigurationError) throw error;
    return null;
  }
}

/** `__Host-` prefix requires Secure, so it is only used in production. */
export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-em_session" : "em_session";
}
