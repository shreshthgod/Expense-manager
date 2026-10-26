import { ApiError } from "@/lib/api/errors";
import { hashRequest, isValidIdempotencyKey, type IdempotencyContext } from "@/server/db/idempotency";

export const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * Builds the idempotency context for a create from the `Idempotency-Key` header.
 * Absent header ⇒ undefined (the request is still executed, just not deduplicated).
 */
export function idempotencyFrom(
  request: Request,
  scope: string,
  payload: unknown,
  successStatus = 201
): IdempotencyContext | undefined {
  const key = request.headers.get(IDEMPOTENCY_HEADER);
  if (!key) return undefined;
  if (!isValidIdempotencyKey(key)) {
    throw ApiError.badRequest("Idempotency-Key must be 8-128 characters of [A-Za-z0-9._:-]", "INVALID_IDEMPOTENCY_KEY");
  }
  return { key, scope, requestHash: hashRequest(scope, payload), successStatus };
}
