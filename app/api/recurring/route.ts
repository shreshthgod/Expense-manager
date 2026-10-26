import { created, ok, readJson, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { idempotencyFrom } from "@/lib/api/idempotency";
import { recurringCreateSchema, recurringQuerySchema } from "@/lib/validation/schemas";
import { createRecurring, listRecurring } from "@/server/services/recurring.service";

export const runtime = "nodejs";

export const GET = withAuth(async ({ request, userId }) => {
  const q = recurringQuerySchema.parse(searchParamsObject(request));
  return ok(await listRecurring(userId, { kind: q.kind, includeInactive: q.includeInactive ?? true }));
});

export const POST = withAuth(async ({ request, userId }) => {
  const input = recurringCreateSchema.parse(await readJson(request));
  const { recurring } = await createRecurring(userId, input, { idempotency: idempotencyFrom(request, "recurring.create", input) });
  return created(recurring, `${input.kind === "BILL" ? "Bill" : input.kind === "SUBSCRIPTION" ? "Subscription" : "Recurring item"} created`);
});
