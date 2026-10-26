import { created, ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { merchantSchema } from "@/lib/validation/schemas";
import { createMerchant, listMerchants } from "@/server/services/merchant.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ userId }) => ok(await listMerchants(userId)));

export const POST = withAuth(async ({ request, userId }) => {
  const input = merchantSchema.parse(await readJson(request));
  const result = await createMerchant(userId, input);
  return created(result, result.linked ? `Merchant created; ${result.linked} transaction(s) linked` : "Merchant created");
});
