import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { accountCreateSchema, queryBoolean } from "@/lib/validation/schemas";
import { createAccount, listAccounts, summarizeBalances } from "@/server/services/account.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = searchParamsObject(request);
  const includeArchived = q.includeArchived ? queryBoolean.parse(q.includeArchived) : false;
  const all = await listAccounts(userId, { includeArchived: true });
  return ok({
    accounts: includeArchived ? all : all.filter((a) => !a.archived),
    // Totals always include archived accounts: archiving hides, it doesn't erase wealth.
    summary: summarizeBalances(all),
  });
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = accountCreateSchema.parse(await readJson(request));
  const { account } = await createAccount(userId, input, { idempotency: idempotencyFrom(request, "accounts.create", input) });
  return created(account, "Account created");
});
