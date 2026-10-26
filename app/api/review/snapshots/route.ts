import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { listSnapshots } from "@/server/services/review.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listSnapshots(userId)));
