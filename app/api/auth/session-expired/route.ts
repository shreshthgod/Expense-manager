import { NextResponse } from "next/server";
import { withPublic } from "@/lib/api/route";
import { sessionCookieName } from "@/lib/auth/jwt";

export const runtime = "nodejs";

/**
 * A server-side revoked/expired session can still carry a validly signed
 * cookie, which the edge middleware would treat as signed in (redirect loop
 * between /login and the app). Layouts send such requests here: the dead
 * cookie is cleared and the user lands on /login with their destination kept.
 * Clearing a cookie only; it never touches data.
 */
export const GET = withPublic(async ({ request }) => {
  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const target = new URL("/login", url.origin);
  target.searchParams.set("next", safeNext);
  target.searchParams.set("expired", "1");
  const response = NextResponse.redirect(target);
  response.cookies.set(sessionCookieName(), "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
});
