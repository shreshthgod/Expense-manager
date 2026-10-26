/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.includes("://")) return fallback;
  if (raw.startsWith("/api/") || raw === "/login" || raw === "/register") return fallback;
  return raw;
}
