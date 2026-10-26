import { ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { aiModelName, isAIAvailable } from "@/agents/provider";

export const runtime = "nodejs";

export const GET = withAuth(async () => ok({ available: isAIAvailable(), model: isAIAvailable() ? aiModelName() : null }));
