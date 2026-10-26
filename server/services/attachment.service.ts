import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import { auditTx } from "@/server/services/audit.service";

/**
 * Receipts and documents. Files are stored privately in the database
 * (AttachmentBlob), validated by their actual bytes (not the client's claimed
 * type), capped at 5 MB, and only ever served to their owner.
 */

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

export type AllowedType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Detects the real file type from magic bytes. Returns null for anything else. */
export function sniffContentType(bytes: Uint8Array): AllowedType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export function safeFileName(name: string, type: AllowedType): string {
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[type];
  const base = name
    .replace(/\.[^.]*$/, "")
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .slice(0, 80) || "attachment";
  return `${base}.${ext}`;
}

export interface AttachmentDTO {
  id: string;
  transactionId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

function toDTO(a: { id: string; transactionId: string; fileName: string; contentType: string; size: number; createdAt: Date }): AttachmentDTO {
  return { id: a.id, transactionId: a.transactionId, fileName: a.fileName, contentType: a.contentType, size: a.size, createdAt: a.createdAt.toISOString() };
}

export async function listAttachments(userId: string, transactionId: string): Promise<AttachmentDTO[]> {
  const tx = await prisma.transaction.findFirst({ where: { id: transactionId, userId }, select: { id: true } });
  if (!tx) throw ApiError.notFound("Transaction not found");
  const rows = await prisma.attachment.findMany({ where: { userId, transactionId }, orderBy: { createdAt: "asc" } });
  return rows.map(toDTO);
}

export async function addAttachment(userId: string, transactionId: string, file: { name: string; bytes: Uint8Array }): Promise<AttachmentDTO> {
  if (file.bytes.byteLength === 0) throw ApiError.field("file", "The file is empty");
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw ApiError.field("file", "Files can be at most 5 MB");
  const type = sniffContentType(file.bytes);
  if (!type) throw ApiError.field("file", "Upload a JPEG, PNG, WebP image or a PDF");
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");

  return prisma.$transaction(async (tx) => {
    const owner = await tx.transaction.findFirst({ where: { id: transactionId, userId, deletedAt: null }, select: { id: true } });
    if (!owner) throw ApiError.notFound("Transaction not found");
    const count = await tx.attachment.count({ where: { transactionId } });
    if (count >= MAX_ATTACHMENTS_PER_TRANSACTION) throw ApiError.rule(`A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments.`, "TOO_MANY_ATTACHMENTS");
    const duplicate = await tx.attachment.findFirst({ where: { transactionId, sha256 } });
    if (duplicate) return toDTO(duplicate);
    const row = await tx.attachment.create({
      data: {
        userId,
        transactionId,
        fileName: safeFileName(file.name, type),
        contentType: type,
        size: file.bytes.byteLength,
        sha256,
        blob: { create: { data: Buffer.from(file.bytes) } },
      },
    });
    await auditTx(tx, { userId, action: "TRANSACTION_UPDATED", entity: "Attachment", entityId: row.id, metadata: { transactionId, size: row.size } });
    return toDTO(row);
  });
}

export async function readAttachment(userId: string, id: string) {
  const row = await prisma.attachment.findFirst({ where: { id, userId }, include: { blob: true } });
  if (!row || !row.blob) throw ApiError.notFound("Attachment not found");
  return { ...toDTO(row), data: row.blob.data };
}

export async function deleteAttachment(userId: string, id: string): Promise<void> {
  const r = await prisma.attachment.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw ApiError.notFound("Attachment not found");
}
