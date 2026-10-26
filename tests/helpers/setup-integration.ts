import { vi } from "vitest";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.AUTH_SECRET ??= "integration-test-secret-integration-test-secret-0123";
process.env.AI_API_KEY = "";
process.env.CRON_SECRET = "integration-cron-secret-0123456789";
process.env.RATE_LIMIT_STORE = "memory";

// Next's bundled React exposes `cache`; plain react@18 does not. It's a
// per-request memo, so a pass-through is behaviourally equivalent in tests.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

// A tiny cookie jar stands in for the browser; tests switch the active jar to
// act as different users (see helpers/api.ts).
vi.mock("next/headers", async () => {
  const { cookieStore } = await import("./cookies");
  return { cookies: () => cookieStore.active(), headers: () => new Headers() };
});
