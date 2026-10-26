import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { merchantUpdateSchema } from "@/lib/validation/schemas";
import { deleteMerchant, getMerchantDetail, updateMerchant } from "@/server/services/merchant.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getMerchantDetail(userId, params.id)));

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = merchantUpdateSchema.parse(await readJson(request));
  return ok(await updateMerchant(userId, params.id, input), "Merchant updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteMerchant(userId, params.id);
  return ok({ deleted: true }, "Merchant removed. Transactions keep their original text.");
});
