import { created, ok } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { ApiError } from "@/lib/api/errors";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { addAttachment, listAttachments, MAX_ATTACHMENT_BYTES } from "@/server/services/attachment.service";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async ({ userId, params }) => ok(await listAttachments(userId, params.id)));

/** multipart/form-data with a single `file` field (JPEG, PNG, WebP or PDF, ≤ 5 MB). */
export const POST = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  await enforceRateLimit(`upload:${userId}`, 30, 60_000);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ATTACHMENT_BYTES + 64 * 1024) throw ApiError.field("file", "Files can be at most 5 MB");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw ApiError.badRequest("Send the file as multipart/form-data", "INVALID_UPLOAD");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw ApiError.field("file", "Choose a file to upload");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return created(await addAttachment(userId, params.id, { name: file.name, bytes }), "Attachment uploaded");
});
