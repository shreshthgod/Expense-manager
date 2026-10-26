import { Prisma } from "@prisma/client";

/**
 * Category allocations of ACTUAL transactions: one row per split line for split
 * transactions, one row per transaction otherwise. Every category-level
 * aggregate (budgets, breakdowns, trends, essential spend) reads from here, so
 * a ₹5,000 purchase split ₹3,000 Food / ₹2,000 Household counts ₹3,000 + ₹2,000
 * — never ₹5,000 in both. Refunds carry their own (allocated) category.
 *
 * Columns: id, type, transactionDate, accountId, merchant, merchantId,
 * categoryId, amount. Use as `FROM (${allocations(userId)}) t`.
 */
export function allocations(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT tx."id", tx."type", tx."transactionDate", tx."accountId", tx."merchant", tx."merchantId",
           COALESCE(sp."categoryId", tx."categoryId") AS "categoryId",
           COALESCE(sp."amount", tx."amount") AS "amount"
    FROM "Transaction" tx
    LEFT JOIN "TransactionSplit" sp ON sp."transactionId" = tx."id"
    WHERE tx."userId" = ${userId} AND tx."status" = 'POSTED' AND tx."deletedAt" IS NULL`;
}
