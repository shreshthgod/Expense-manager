import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static guard: every API route handler must be created by withAuth, withPublic
 * or withCron (lib/api/route.ts). A new endpoint cannot silently skip
 * authentication — and anonymous endpoints must be on this explicit allowlist.
 */

const API_DIR = path.resolve(__dirname, "../../app/api");
const PUBLIC_ROUTES = new Set(["auth/login", "auth/register", "auth/session-expired", "health"]);
const CRON_ROUTES = new Set(["cron/run"]);
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

describe("API route guard", () => {
  const files = routeFiles(API_DIR);

  it("finds the API routes", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    const rel = path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
    it(`${rel} wraps every handler`, () => {
      const src = readFileSync(file, "utf8");
      expect(src, "no unwrapped `export async function` handlers").not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
      const exported = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*([A-Za-z]+)/g)];
      expect(exported.length, "exports at least one handler").toBeGreaterThan(0);
      for (const [, method, wrapper] of exported) {
        if (METHODS.includes(wrapper!)) continue; // alias like `export const GET = POST`
        const expected = PUBLIC_ROUTES.has(rel) ? "withPublic" : CRON_ROUTES.has(rel) ? "withCron" : "withAuth";
        expect(wrapper, `${method} in ${rel}`).toBe(expected);
      }
      // Business logic lives in server/services; routes only translate HTTP.
      expect(src, "no Prisma model access in route handlers").not.toMatch(/prisma\.(user|transaction|account|category|budget|savingsGoal|recurringTransaction)\./);
    });
  }
});
