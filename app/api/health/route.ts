import { ok, fail } from "@/lib/api/response";
import { withPublic } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + database reachability. Reveals nothing about users. */
export const GET = withPublic(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return ok({ status: "ok", database: "reachable" });
  } catch {
    return fail(503, "DATABASE_UNAVAILABLE", "Database unreachable");
  }
});
