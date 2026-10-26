import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiError } from "@/lib/api/errors";
import type { templateSchema } from "@/lib/validation/schemas";
import { requireOwnedAccounts, requireOwnedCategory } from "@/server/services/ownership";

/** Favourite entries that prefill the transaction form (never auto-submitted). */
export type TemplateInput = z.infer<typeof templateSchema>;

export interface TemplateDTO {
  id: string;
  name: string;
  type: "EXPENSE" | "INCOME" | "TRANSFER";
  amount: number | null;
  accountId: string | null;
  destinationAccountId: string | null;
  categoryId: string | null;
  merchant: string | null;
  description: string | null;
  tags: string[];
}

function toDTO(t: Prisma.TransactionTemplateGetPayload<object>): TemplateDTO {
  return {
    id: t.id,
    name: t.name,
    type: t.type as TemplateDTO["type"],
    amount: t.amount != null ? Number(t.amount) : null,
    accountId: t.accountId,
    destinationAccountId: t.destinationAccountId,
    categoryId: t.categoryId,
    merchant: t.merchant,
    description: t.description,
    tags: t.tags,
  };
}

export async function listTemplates(userId: string): Promise<TemplateDTO[]> {
  const rows = await prisma.transactionTemplate.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return rows.map(toDTO);
}

async function validate(userId: string, input: Partial<TemplateInput>) {
  await requireOwnedAccounts(prisma, userId, [
    { path: "accountId", id: input.accountId, allowArchived: false },
    { path: "destinationAccountId", id: input.destinationAccountId, allowArchived: false },
  ]);
  if (input.categoryId) await requireOwnedCategory(prisma, userId, input.categoryId, input.type === "INCOME" ? "INCOME" : "EXPENSE");
}

export async function createTemplate(userId: string, input: TemplateInput): Promise<TemplateDTO> {
  await validate(userId, input);
  const exists = await prisma.transactionTemplate.findFirst({ where: { userId, name: { equals: input.name, mode: "insensitive" } } });
  if (exists) throw ApiError.field("name", "You already have a favourite with this name");
  const row = await prisma.transactionTemplate.create({
    data: {
      userId,
      name: input.name,
      type: input.type,
      amount: input.amount != null ? new Prisma.Decimal(input.amount.toFixed(2)) : null,
      accountId: input.accountId ?? null,
      destinationAccountId: input.type === "TRANSFER" ? (input.destinationAccountId ?? null) : null,
      categoryId: input.type === "TRANSFER" ? null : (input.categoryId ?? null),
      merchant: input.merchant ?? null,
      description: input.description ?? null,
      tags: input.tags,
    },
  });
  return toDTO(row);
}

export async function updateTemplate(userId: string, id: string, input: Partial<TemplateInput>): Promise<TemplateDTO> {
  const existing = await prisma.transactionTemplate.findFirst({ where: { id, userId } });
  if (!existing) throw ApiError.notFound("Favourite not found");
  await validate(userId, { ...input, type: input.type ?? (existing.type as TemplateInput["type"]) });
  const row = await prisma.transactionTemplate.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.amount !== undefined ? { amount: input.amount != null ? new Prisma.Decimal(input.amount.toFixed(2)) : null } : {}),
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.destinationAccountId !== undefined ? { destinationAccountId: input.destinationAccountId } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.merchant !== undefined ? { merchant: input.merchant } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    },
  });
  return toDTO(row);
}

export async function deleteTemplate(userId: string, id: string) {
  const r = await prisma.transactionTemplate.deleteMany({ where: { id, userId } });
  if (r.count === 0) throw ApiError.notFound("Favourite not found");
}
