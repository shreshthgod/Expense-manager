import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { onboardingStepSchema } from "@/lib/validation/schemas";
import { applyOnboardingStep, getOnboarding } from "@/server/services/onboarding.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await getOnboarding(userId)));

/** One step at a time; each step is idempotent so refresh/retry never duplicates. */
export const POST = withAuth(async ({ request, userId }) => {
  const input = onboardingStepSchema.parse(await readJson(request));
  return ok(await applyOnboardingStep(userId, input), "Saved");
});
