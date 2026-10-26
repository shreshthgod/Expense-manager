import { timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/errors";
import { errorResponse } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";

/**
 * Route wrappers. Every file under app/api/** exports handlers created by one
 * of these — enforced by tests/unit/route-guard.test.ts — so a new endpoint
 * cannot forget authentication:
 *
 *   withAuth   authenticated user (session cookie + live Session row)
 *   withPublic intentionally anonymous (login, register, health)
 *   withCron   scheduler, authenticated by CRON_SECRET bearer token
 *
 * All wrappers normalise errors into the standard envelope.
 */

export interface RouteContext<P> {
  request: Request;
  params: P;
}

export interface AuthedContext<P> extends RouteContext<P> {
  userId: string;
  sessionId: string;
}

type Params = Record<string, string>;
type NextHandler<P> = (request: Request, context: { params: P }) => Promise<NextResponse>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Defence in depth against CSRF (cookies are already SameSite=Lax and the API
 * only accepts JSON): browsers always send Origin on cross-origin mutations,
 * so a mismatching Origin or a cross-site fetch is rejected.
 */
export function assertSameOrigin(request: Request): void {
  if (!MUTATING.has(request.method)) return;
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw ApiError.forbidden("Cross-site requests are not allowed");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw ApiError.forbidden("Invalid request origin");
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const allowed = new Set<string>();
  if (host) allowed.add(host);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).host);
    } catch {
      /* ignore malformed APP_URL */
    }
  }
  if (!allowed.has(originHost)) throw ApiError.forbidden("Cross-origin requests are not allowed");
}

function routeLabel(request: Request) {
  try {
    return { route: new URL(request.url).pathname, method: request.method };
  } catch {
    return { method: request.method };
  }
}

export function withAuth<P extends Params = Params>(handler: (ctx: AuthedContext<P>) => Promise<NextResponse>): NextHandler<P> {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      const session = await getSession();
      if (!session) throw ApiError.unauthorized();
      return await handler({ request, params: (context?.params ?? {}) as P, ...session });
    } catch (error) {
      return errorResponse(error, routeLabel(request));
    }
  };
}

export function withPublic<P extends Params = Params>(handler: (ctx: RouteContext<P>) => Promise<NextResponse>): NextHandler<P> {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      return await handler({ request, params: (context?.params ?? {}) as P });
    } catch (error) {
      return errorResponse(error, routeLabel(request));
    }
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function withCron<P extends Params = Params>(handler: (ctx: RouteContext<P>) => Promise<NextResponse>): NextHandler<P> {
  return async (request, context) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || secret.length < 16) {
        throw ApiError.unavailable("Scheduler endpoint is disabled: CRON_SECRET is not configured.", "CRON_DISABLED");
      }
      const header = request.headers.get("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token || !safeEqual(token, secret)) throw ApiError.unauthorized("Invalid scheduler credentials");
      return await handler({ request, params: (context?.params ?? {}) as P });
    } catch (error) {
      return errorResponse(error, routeLabel(request));
    }
  };
}
