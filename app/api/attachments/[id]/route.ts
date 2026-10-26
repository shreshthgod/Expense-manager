import { NextResponse } from "next/server";
import { ok, searchParamsObject } from "@/lib/api/response";
import { withAuth } from "@/lib/api/route";
import { deleteAttachment, readAttachment } from "@/server/services/attachment.service";

export const runtime = "nodejs";

/**
 * Owner-only download. Served with nosniff and a sandboxing CSP so a crafted
 * file can never run script in the app's origin. `?download=1` forces a save.
 */
export const GET = withAuth<{ id: string }>(async ({ request, userId, params }) => {
  const file = await readAttachment(userId, params.id);
  const download = searchParamsObject(request).download === "1";
  const disposition = `${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/"/g, "")}"`;
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": disposition,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});

export const DELETE = withAuth<{ id: string }>(async ({ userId, params }) => {
  await deleteAttachment(userId, params.id);
  return ok({ deleted: true }, "Attachment removed");
});
