import { NextResponse, type NextRequest } from "next/server";
import { sessionCookieName, verifySessionToken } from "@/lib/auth/jwt";

/**
 * Page-level gate (edge runtime). It only checks the token signature/expiry;
 * revocation is enforced server-side on every request by lib/auth/session.ts
 * (layouts and API routes), because the edge runtime cannot query the database.
 * API routes are protected by the withAuth wrapper, not by this middleware.
 */

const PUBLIC_PATHS = ["/", "/login", "/register", "/offline"];
const AUTH_PAGES = ["/login", "/register"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/legal");
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(sessionCookieName())?.value;
  let claims = null;
  try {
    claims = await verifySessionToken(token);
  } catch {
    claims = null;
  }

  if (!isPublic(pathname) && !claims) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return noStore(NextResponse.redirect(loginUrl));
  }

  if (claims && AUTH_PAGES.includes(pathname)) {
    return noStore(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  // Per-request nonce: Next applies it to its own scripts when it sees it in
  // the request's CSP header; the layout passes it to the theme script.
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  // Expose the path to server layouts (used to preserve the destination on expiry).
  const headers = new Headers(request.headers);
  headers.set("x-pathname", `${pathname}${search}`);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return noStore(response);
}

/**
 * Pages show private financial data and redirects depend on the session:
 * never let a shared cache or CDN store them (also mitigates redirect
 * cache-poisoning advisories affecting Next 14).
 */
function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Charts and motion set inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|robots.txt|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)",
  ],
};
