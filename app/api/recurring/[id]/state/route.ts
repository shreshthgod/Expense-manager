import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { recurringStateSchema } from "@/lib/validation/schemas";
import { changeRecurringState } from "@/server/services/recurring.service";

export const runtime = "nodejs";

const MESSAGES = { pause: "Paused", resume: "Resumed", cancel: "Cancelled" } as const;

export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = recurringStateSchema.parse(await readJson(request));
  return ok(await changeRecurringState(userId, params.id, input), MESSAGES[input.action]);
});
