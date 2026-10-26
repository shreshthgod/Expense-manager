import { Prisma } from "@prisma/client";

/**
 * SQL mirrors of the ledger rules for aggregate queries (balance history,
 * integrity checks). Must stay equivalent to `ledgerEffects()` in effects.ts —
 * tests/integration/ledger-invariants.test.ts compares the two.
 *
 * All fragments assume the transaction table is aliased `t`.
 */

/** Only these rows affect actual balances and actual income/spending. */
export const POSTED_ACTIVE = Prisma.sql`t."status" = 'POSTED' AND t."deletedAt" IS NULL`;

/** Signed effect of row `t` on account `accountIdExpr` (an SQL expression). */
export function signedEffectOn(accountIdExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN t."accountId" = ${accountIdExpr} AND t."type"::text = 'EXPENSE' THEN -t."amount"
    WHEN t."accountId" = ${accountIdExpr} AND t."type"::text IN ('INCOME', 'REFUND') THEN t."amount"
    WHEN t."accountId" = ${accountIdExpr} AND t."type"::text = 'TRANSFER' AND t."destinationAccountId" IS NOT NULL THEN -t."amount"
    WHEN t."destinationAccountId" = ${accountIdExpr} AND t."type"::text = 'TRANSFER' AND t."accountId" IS NOT NULL THEN t."amount"
    WHEN t."accountId" = ${accountIdExpr} AND t."type"::text = 'ADJUSTMENT' THEN -t."amount"
    WHEN t."destinationAccountId" = ${accountIdExpr} AND t."type"::text = 'ADJUSTMENT' THEN t."amount"
    ELSE 0 END)`;
}
