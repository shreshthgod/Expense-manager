import { isIP } from "node:net";

/**
 * Client IP extraction that only trusts proxy headers when told to.
 *
 * TRUSTED_PROXY_HOPS = number of reverse proxies in front of the app that
 * APPEND the client address to X-Forwarded-For (Vercel/most load balancers: 1).
 * With 0 (default outside Vercel) forwarding headers are ignored entirely, so a
 * client cannot pick its own rate-limit bucket by spoofing them.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw != null && raw !== "") {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
  }
  return process.env.VERCEL ? 1 : 0;
}

export function getClientIp(request: Request): string | null {
  const hops = trustedProxyHops();
  if (hops === 0) return null;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const candidate = parts[parts.length - hops];
    if (candidate && isIP(candidate)) return candidate;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real && isIP(real)) return real;
  return null;
}

export function getUserAgent(request: Request): string | null {
  return request.headers.get("user-agent")?.slice(0, 300) ?? null;
}

export function requestMeta(request: Request) {
  return { ipAddress: getClientIp(request), userAgent: getUserAgent(request) };
}
