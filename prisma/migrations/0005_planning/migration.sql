-- ============================================================================
-- 0005_planning
--
-- Planning features:
--  * Budget.rolloverMode (NONE / POSITIVE_ONLY / FULL) and BudgetTemplate.
--  * SavingsGoal kinds (savings, sinking fund, emergency fund), linked account,
--    planned monthly contribution, yearly repeat, archive/complete markers.
--  * GoalContribution ledger. Existing saved amounts become one opening
--    contribution each, so Σ contributions = currentAmount holds from day one.
--  * FinancialSnapshot: month-end snapshots + "month reviewed" marker.
--  * AIConversation.pinned.
--
-- Rollback: drop the new tables/columns/types; SavingsGoal.currentAmount is
-- unchanged by this migration.
-- ============================================================================

-- CreateEnum
CREATE TYPE "RolloverMode" AS ENUM ('NONE', 'POSITIVE_ONLY', 'FULL');

-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('SAVINGS', 'SINKING_FUND', 'EMERGENCY_FUND');

-- AlterTable
ALTER TABLE "AIConversation" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "rolloverMode" "RolloverMode" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "SavingsGoal" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "kind" "GoalKind" NOT NULL DEFAULT 'SAVINGS',
ADD COLUMN     "monthlyContribution" DECIMAL(14,2),
ADD COLUMN     "repeatsYearly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BudgetTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "assets" DECIMAL(14,2) NOT NULL,
    "liabilities" DECIMAL(14,2) NOT NULL,
    "netWorth" DECIMAL(14,2) NOT NULL,
    "liquid" DECIMAL(14,2) NOT NULL,
    "income" DECIMAL(14,2) NOT NULL,
    "netSpending" DECIMAL(14,2) NOT NULL,
    "surplus" DECIMAL(14,2) NOT NULL,
    "data" JSONB NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetTemplate_userId_name_key" ON "BudgetTemplate"("userId", "name");

-- CreateIndex
CREATE INDEX "GoalContribution_goalId_date_idx" ON "GoalContribution"("goalId", "date");

-- CreateIndex
CREATE INDEX "GoalContribution_userId_date_idx" ON "GoalContribution"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSnapshot_userId_periodStart_key" ON "FinancialSnapshot"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "BudgetTemplate" ADD CONSTRAINT "BudgetTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Opening contribution for every goal that already has money saved.
INSERT INTO "GoalContribution" ("id", "userId", "goalId", "amount", "date", "note", "createdAt")
SELECT 'c' || substr(md5(random()::TEXT || clock_timestamp()::TEXT || g."id"), 1, 24),
       g."userId", g."id", g."currentAmount",
       ((g."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE,
       'Amount saved before contributions were tracked', CURRENT_TIMESTAMP
FROM "SavingsGoal" g
WHERE g."currentAmount" > 0;

ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_current_nonnegative" CHECK ("currentAmount" >= 0) NOT VALID;
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_amount_nonzero" CHECK ("amount" <> 0);
