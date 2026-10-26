import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { whatIfSchema } from "@/lib/validation/schemas";
import { simulateWhatIf } from "@/server/services/planning.service";
import { narrateWhatIf } from "@/server/services/planning-narrative.service";

export const runtime = "nodejs";

/** Deterministic scenario. `explain: true` adds an AI (or template) narration of the computed numbers. */
export const POST = withAuth(async ({ request, userId }) => {
  const input = whatIfSchema.parse(await readJson(request));
  const result = await simulateWhatIf(userId, input);
  return ok(input.explain ? { ...result, narrative: await narrateWhatIf(userId, input, result) } : result);
});
