import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { getInsightsWithNarrative } from "@/server/services/insight.service";
import { isAIAvailable } from "@/agents/provider";

export const runtime = "nodejs";

/** Deterministic insight cards (+ optional AI summary when a provider is configured). */
export const GET = withAuth(async ({ userId }) => ok({ ...(await getInsightsWithNarrative(userId)), aiAvailable: isAIAvailable() }));
