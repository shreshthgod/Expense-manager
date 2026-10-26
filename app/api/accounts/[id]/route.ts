import { ok, readJson } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { accountUpdateSchema } from "@/lib/validation/schemas";
import { deleteAccount, getAccountDetail, updateAccount } from "@/server/services/account.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await getAccountDetail(userId, params.id)));

export const PATCH = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const input = accountUpdateSchema.parse(await readJson(request));
  const account = await updateAccount(userId, params.id, input);
  return ok(account, input.archived === true ? "Account archived" : input.archived === false ? "Account restored" : "Account updated");
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteAccount(userId, params.id);
  return ok({ deleted: true }, "Account deleted");
});
