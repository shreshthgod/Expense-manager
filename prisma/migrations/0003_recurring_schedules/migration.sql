-- ============================================================================
-- 0003_recurring_schedules
--
-- Unifies recurring transactions, bills and subscriptions on ONE rule model
-- with explicit occurrences.
--  * RecurringTransaction gains kind (STANDARD/BILL/SUBSCRIPTION), a display
--    name, an anchor startDate + interval (quarterly = MONTHLY × 3), an optional
--    destination account (recurring transfers), autopay/reminder settings and
--    cancellation.
--  * RecurringOccurrence stores each scheduled instance. UNIQUE(recurringId,
--    dueDate) makes the scheduler idempotent under retries and concurrent
--    workers; UNIQUE(transactionId) guarantees a payment settles at most one
--    occurrence.
--  * Existing auto-created transactions are linked as RECORDED occurrences.
--  * New notification types for bills, subscriptions, goals and imports.
--
-- Rollback: DROP TABLE "RecurringOccurrence"; drop the added columns and enum
-- types. No existing data is modified destructively.
-- ============================================================================

-- CreateEnum
CREATE TYPE "RecurringKind" AS ENUM ('STANDARD', 'BILL', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('SCHEDULED', 'DUE', 'RECORDED', 'SKIPPED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GOAL_MILESTONE';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL';
ALTER TYPE "NotificationType" ADD VALUE 'IMPORT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'RECURRING_FAILED';

-- AlterTable
ALTER TABLE "RecurringTransaction" ADD COLUMN     "autopay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "destinationAccountId" TEXT,
ADD COLUMN     "interval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "kind" "RecurringKind" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "startDate" DATE;


-- Anchor existing rules on their first recorded occurrence (or next due date).
UPDATE "RecurringTransaction" r
SET "startDate" = LEAST(
  r."nextExecutionDate",
  COALESCE((SELECT MIN(t."transactionDate") FROM "Transaction" t WHERE t."recurringTransactionId" = r."id"), r."nextExecutionDate")
);
ALTER TABLE "RecurringTransaction" ALTER COLUMN "startDate" SET NOT NULL;
UPDATE "RecurringTransaction" SET "name" = COALESCE("merchant", "description") WHERE "name" IS NULL;

ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_interval_positive" CHECK ("interval" >= 1 AND "interval" <= 60);
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_reminder_range" CHECK ("reminderDaysBefore" >= 0 AND "reminderDaysBefore" <= 60);
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_amount_positive" CHECK ("amount" > 0) NOT VALID;

-- CreateTable
CREATE TABLE "RecurringOccurrence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'DUE',
    "transactionId" TEXT,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "failureReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_transactionId_key" ON "RecurringOccurrence"("transactionId");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_userId_dueDate_idx" ON "RecurringOccurrence"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "RecurringOccurrence_userId_status_idx" ON "RecurringOccurrence"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringOccurrence_recurringId_dueDate_key" ON "RecurringOccurrence"("recurringId", "dueDate");

-- CreateIndex
CREATE INDEX "RecurringTransaction_userId_kind_idx" ON "RecurringTransaction"("userId", "kind");

-- CreateIndex
CREATE INDEX "RecurringTransaction_active_nextExecutionDate_idx" ON "RecurringTransaction"("active", "nextExecutionDate");

-- AddForeignKey
ALTER TABLE "RecurringTransaction" ADD CONSTRAINT "RecurringTransaction_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "RecurringOccurrence" ADD CONSTRAINT "RecurringOccurrence_amount_positive" CHECK ("amount" > 0);

-- Link transactions that v1 materialised from rules as RECORDED occurrences.
INSERT INTO "RecurringOccurrence" ("id", "userId", "recurringId", "dueDate", "amount", "status",
                                   "transactionId", "ruleVersion", "resolvedAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (t."recurringTransactionId", t."transactionDate")
       'c' || substr(md5(random()::TEXT || clock_timestamp()::TEXT || t."id"), 1, 24),
       t."userId", t."recurringTransactionId", t."transactionDate", t."amount", 'RECORDED',
       t."id", 1, t."createdAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Transaction" t
JOIN "RecurringTransaction" r ON r."id" = t."recurringTransactionId" AND r."userId" = t."userId"
WHERE t."recurringTransactionId" IS NOT NULL AND t."deletedAt" IS NULL AND t."amount" > 0
ORDER BY t."recurringTransactionId", t."transactionDate", t."createdAt"
ON CONFLICT DO NOTHING;
