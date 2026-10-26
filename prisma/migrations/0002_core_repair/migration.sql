-- ============================================================================
-- 0002_core_repair
--
-- Core repair + security foundation. Hand-reviewed; contains data migrations.
--
--  1. Categories become per-user. Global system rows (userId NULL) are copied
--     into every user's own category set and every FK is remapped to the copy.
--     Income defaults that were seeded as EXPENSE get their correct type.
--  2. Accounts gain openingBalance (derived so that the ledger invariant
--     balance = openingBalance + Σ effects holds for existing data), archive,
--     institution, notes and net-worth inclusion.
--  3. TRANSFER gains a destination account.
--  4. Server-side sessions (revocable).
--  5. Notification dedupe moves from metadata to a unique (userId, dedupeKey).
--  6. Recurring budgets (WEEKLY/MONTHLY/YEARLY) no longer carry the auto-computed
--     one-cycle endDate that made them silently expire after a single period.
--  7. Preference + audit columns.
--  8. Financial dates become calendar DATEs, converted through Asia/Kolkata
--     (the app's default financial time zone). Values written by v1 were either
--     UTC midnight (UI) or local midnight (seed); both map to the intended day.
--  9. Transactions gain status (PLANNED/POSTED), soft delete and a version for
--     optimistic concurrency; ADJUSTMENT type for explicit balance corrections.
-- 10. Idempotency records, a transactional outbox and shared rate-limit buckets.
--
-- Rollback: this migration is not automatically reversible (categories are
-- split per user). Restore from the pre-migration database backup, or see
-- prisma/migrations/README.md for the manual reverse procedure.
-- ============================================================================

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PLANNED', 'POSTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SpendingClass" AS ENUM ('ESSENTIAL', 'DISCRETIONARY');

-- CreateEnum
CREATE TYPE "CostBehavior" AS ENUM ('FIXED', 'VARIABLE');

-- AlterEnum (PostgreSQL >= 12: new values are not used within this migration)
ALTER TYPE "AccountType" ADD VALUE 'LOAN';
ALTER TYPE "AccountType" ADD VALUE 'OTHER_ASSET';
ALTER TYPE "AccountType" ADD VALUE 'OTHER_LIABILITY';
ALTER TYPE "TransactionType" ADD VALUE 'ADJUSTMENT';

-- ----------------------------------------------------------------------------
-- Calendar dates (no time component). Convert through the financial time zone.
-- ----------------------------------------------------------------------------
ALTER TABLE "Transaction" ALTER COLUMN "transactionDate" SET DATA TYPE DATE
  USING (("transactionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "Budget" ALTER COLUMN "startDate" SET DATA TYPE DATE
  USING (("startDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "Budget" ALTER COLUMN "endDate" SET DATA TYPE DATE
  USING (("endDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "SavingsGoal" ALTER COLUMN "deadline" SET DATA TYPE DATE
  USING (("deadline" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "RecurringTransaction" ALTER COLUMN "nextExecutionDate" SET DATA TYPE DATE
  USING (("nextExecutionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "RecurringTransaction" ALTER COLUMN "endDate" SET DATA TYPE DATE
  USING (("endDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "AIReport" ALTER COLUMN "startDate" SET DATA TYPE DATE
  USING (("startDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE "AIReport" ALTER COLUMN "endDate" SET DATA TYPE DATE
  USING (("endDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE;

-- ----------------------------------------------------------------------------
-- Accounts
-- ----------------------------------------------------------------------------
ALTER TABLE "Account" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "includeInNetWorth" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "institution" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingDate" DATE,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Derive the opening balance from the materialized balance and the v1 ledger
-- rules (EXPENSE -amount, INCOME +amount, TRANSFER 0).
UPDATE "Account" a
SET "openingBalance" = a."balance" - COALESCE((
  SELECT SUM(CASE WHEN t."type" = 'INCOME' THEN t."amount"
                  WHEN t."type" = 'EXPENSE' THEN -t."amount"
                  ELSE 0 END)
  FROM "Transaction" t
  WHERE t."accountId" = a."id"
), 0);

-- The opening position precedes every existing transaction of the account.
UPDATE "Account" a
SET "openingDate" = LEAST(
  ((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE,
  COALESCE((SELECT MIN(t."transactionDate") FROM "Transaction" t WHERE t."accountId" = a."id"),
           ((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::DATE)
);

-- ----------------------------------------------------------------------------
-- Audit
-- ----------------------------------------------------------------------------
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- ----------------------------------------------------------------------------
-- Categories -> per user
-- ----------------------------------------------------------------------------
ALTER TABLE "Category" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "costBehavior" "CostBehavior",
ADD COLUMN     "spendingClass" "SpendingClass",
ALTER COLUMN "type" SET DEFAULT 'EXPENSE';

-- The global (name, isSystem) uniqueness blocks per-user copies; drop it first.
DROP INDEX "Category_isSystem_idx";
DROP INDEX "Category_name_isSystem_key";
DROP INDEX "Category_userId_idx";

-- Default category templates. Must stay in sync with DEFAULT_CATEGORIES in
-- lib/constants/categories.ts.
CREATE TEMP TABLE "_cat_tpl" (
  "name" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL,
  "icon" TEXT,
  "color" TEXT,
  "sclass" TEXT,
  "cbeh" TEXT
);
INSERT INTO "_cat_tpl" ("name", "type", "icon", "color", "sclass", "cbeh") VALUES
  ('Food',          'EXPENSE', 'UtensilsCrossed', '#f97316', 'DISCRETIONARY', 'VARIABLE'),
  ('Groceries',     'EXPENSE', 'ShoppingBasket',  '#22c55e', 'ESSENTIAL',     'VARIABLE'),
  ('Transport',     'EXPENSE', 'Car',             '#3b82f6', 'ESSENTIAL',     'VARIABLE'),
  ('Shopping',      'EXPENSE', 'ShoppingBag',     '#ec4899', 'DISCRETIONARY', 'VARIABLE'),
  ('Entertainment', 'EXPENSE', 'Popcorn',         '#a855f7', 'DISCRETIONARY', 'VARIABLE'),
  ('Bills',         'EXPENSE', 'ReceiptText',     '#64748b', 'ESSENTIAL',     'FIXED'),
  ('Rent',          'EXPENSE', 'Home',            '#14b8a6', 'ESSENTIAL',     'FIXED'),
  ('Utilities',     'EXPENSE', 'Lightbulb',       '#eab308', 'ESSENTIAL',     'VARIABLE'),
  ('Household',     'EXPENSE', 'Sofa',            '#a16207', 'ESSENTIAL',     'VARIABLE'),
  ('Healthcare',    'EXPENSE', 'HeartPulse',      '#ef4444', 'ESSENTIAL',     'VARIABLE'),
  ('Education',     'EXPENSE', 'GraduationCap',   '#6366f1', 'ESSENTIAL',     'FIXED'),
  ('Travel',        'EXPENSE', 'Plane',           '#06b6d4', 'DISCRETIONARY', 'VARIABLE'),
  ('Subscriptions', 'EXPENSE', 'Repeat',          '#8b5cf6', 'DISCRETIONARY', 'FIXED'),
  ('Personal Care', 'EXPENSE', 'Sparkles',        '#f43f5e', 'DISCRETIONARY', 'VARIABLE'),
  ('Insurance',     'EXPENSE', 'ShieldCheck',     '#0ea5e9', 'ESSENTIAL',     'FIXED'),
  ('EMI & Loans',   'EXPENSE', 'Landmark',        '#475569', 'ESSENTIAL',     'FIXED'),
  ('Investment',    'EXPENSE', 'TrendingUp',      '#10b981', NULL,            'VARIABLE'),
  ('Other',         'EXPENSE', 'CircleEllipsis',  '#94a3b8', NULL,            'VARIABLE'),
  ('Salary',        'INCOME',  'Briefcase',       '#16a34a', NULL,            NULL),
  ('Freelance',     'INCOME',  'Laptop',          '#0d9488', NULL,            NULL),
  ('Business',      'INCOME',  'Building2',       '#2563eb', NULL,            NULL),
  ('Interest',      'INCOME',  'Percent',         '#ca8a04', NULL,            NULL),
  ('Gift',          'INCOME',  'Gift',            '#db2777', NULL,            NULL),
  ('Other Income',  'INCOME',  'Banknote',        '#15803d', NULL,            NULL);

-- One row per (user, global category): reuse the user's own category of the
-- same name when one exists, otherwise mint a new per-user copy.
CREATE TEMP TABLE "_cat_map" AS
SELECT
  u."id" AS "user_id",
  g."id" AS "old_id",
  g."name" AS "name",
  g."type"::TEXT AS "old_type",
  g."icon" AS "old_icon",
  g."color" AS "old_color",
  (SELECT c."id" FROM "Category" c
    WHERE c."userId" = u."id" AND lower(c."name") = lower(g."name")
    ORDER BY c."createdAt" LIMIT 1) AS "existing_id",
  'c' || substr(md5(random()::TEXT || clock_timestamp()::TEXT || u."id" || g."id"), 1, 24) AS "new_id"
FROM "User" u
CROSS JOIN "Category" g
WHERE g."userId" IS NULL;

INSERT INTO "Category" ("id", "userId", "name", "icon", "color", "type", "isSystem",
                        "spendingClass", "costBehavior", "createdAt", "updatedAt")
SELECT m."new_id", m."user_id", m."name",
       COALESCE(t."icon", m."old_icon"),
       COALESCE(t."color", m."old_color"),
       COALESCE(t."type", m."old_type")::"CategoryType",
       true,
       t."sclass"::"SpendingClass",
       t."cbeh"::"CostBehavior",
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_cat_map" m
LEFT JOIN "_cat_tpl" t ON t."name" = m."name"
WHERE m."existing_id" IS NULL;

UPDATE "_cat_map" SET "new_id" = "existing_id" WHERE "existing_id" IS NOT NULL;

UPDATE "Transaction" x SET "categoryId" = m."new_id"
FROM "_cat_map" m WHERE x."categoryId" = m."old_id" AND x."userId" = m."user_id";

UPDATE "Budget" x SET "categoryId" = m."new_id"
FROM "_cat_map" m WHERE x."categoryId" = m."old_id" AND x."userId" = m."user_id";

UPDATE "RecurringTransaction" x SET "categoryId" = m."new_id"
FROM "_cat_map" m WHERE x."categoryId" = m."old_id" AND x."userId" = m."user_id";

-- Global rows are now unreferenced by any user data.
DELETE FROM "Category" WHERE "userId" IS NULL;

-- Give every existing user the full default set (new users get it at registration).
INSERT INTO "Category" ("id", "userId", "name", "icon", "color", "type", "isSystem",
                        "spendingClass", "costBehavior", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::TEXT || clock_timestamp()::TEXT || u."id" || t."name"), 1, 24),
       u."id", t."name", t."icon", t."color", t."type"::"CategoryType", true,
       t."sclass"::"SpendingClass", t."cbeh"::"CostBehavior", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN "_cat_tpl" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND lower(c."name") = lower(t."name")
);

DROP TABLE "_cat_map";
DROP TABLE "_cat_tpl";

ALTER TABLE "Category" ALTER COLUMN "userId" SET NOT NULL;

-- ----------------------------------------------------------------------------
-- Notifications: first-class dedupe key
-- ----------------------------------------------------------------------------
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

UPDATE "Notification"
SET "dedupeKey" = "metadata"->>'dedupeKey'
WHERE "metadata" IS NOT NULL
  AND jsonb_typeof("metadata") = 'object'
  AND "metadata" ? 'dedupeKey';

-- Earlier code re-fired a key after the previous notification was read; keep
-- the newest row as the key holder so the unique index can be created.
UPDATE "Notification" n SET "dedupeKey" = NULL
WHERE n."dedupeKey" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Notification" n2
    WHERE n2."userId" = n."userId"
      AND n2."dedupeKey" = n."dedupeKey"
      AND (n2."createdAt" > n."createdAt" OR (n2."createdAt" = n."createdAt" AND n2."id" > n."id"))
  );

-- ----------------------------------------------------------------------------
-- Transactions: transfers, status, soft delete, versioning, integrity checks
-- ----------------------------------------------------------------------------
ALTER TABLE "Transaction" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "destinationAccountId" TEXT,
ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- Amounts are always positive; direction comes from the type.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amount_positive" CHECK ("amount" > 0) NOT VALID;

-- A live TRANSFER needs two different accounts. NOT VALID: legacy v1 transfers
-- recorded no destination (and moved no money); they stay readable and must be
-- given a destination when edited, or can be deleted.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_transfer_shape" CHECK (
  "deletedAt" IS NOT NULL
  OR "type"::TEXT <> 'TRANSFER'
  OR ("accountId" IS NOT NULL AND "destinationAccountId" IS NOT NULL AND "accountId" <> "destinationAccountId")
) NOT VALID;

-- Only transfers and adjustments may reference a destination account; an
-- adjustment touches exactly one account.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destination_usage" CHECK (
  "destinationAccountId" IS NULL OR "type"::TEXT IN ('TRANSFER', 'ADJUSTMENT')
);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_adjustment_shape" CHECK (
  "type"::TEXT <> 'ADJUSTMENT'
  OR (("accountId" IS NULL) <> ("destinationAccountId" IS NULL))
);

DO $$
BEGIN
  ALTER TABLE "Transaction" VALIDATE CONSTRAINT "Transaction_amount_positive";
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'Legacy rows have non-positive amounts; the check applies to new writes only.';
END $$;

-- ----------------------------------------------------------------------------
-- Budgets: recurring periods are open-ended cycles
-- ----------------------------------------------------------------------------
UPDATE "Budget" SET "endDate" = NULL WHERE "period" <> 'CUSTOM';

-- ----------------------------------------------------------------------------
-- Preferences
-- ----------------------------------------------------------------------------
ALTER TABLE "UserPreference" ADD COLUMN     "dashboardLayout" JSONB,
ADD COLUMN     "defaultAccountId" TEXT,
ADD COLUMN     "emergencyFundMonths" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "monthStartDay" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "notifyAnomalies" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyBills" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "motion" TEXT NOT NULL DEFAULT 'system';

ALTER TABLE "Profile" ADD COLUMN     "onboardingState" JSONB;

-- ----------------------------------------------------------------------------
-- Optimistic concurrency versions
-- ----------------------------------------------------------------------------
ALTER TABLE "Budget" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SavingsGoal" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RecurringTransaction" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- Sessions
-- ----------------------------------------------------------------------------
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- Idempotency, outbox, shared rate limiting
-- ----------------------------------------------------------------------------
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "IdempotencyRecord_createdAt_idx" ON "IdempotencyRecord"("createdAt");
CREATE UNIQUE INDEX "IdempotencyRecord_userId_key_key" ON "IdempotencyRecord"("userId", "key");
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE INDEX "OutboxEvent_userId_createdAt_idx" ON "OutboxEvent"("userId", "createdAt");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Indexes & foreign keys
-- ----------------------------------------------------------------------------
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Account_userId_archivedAt_idx" ON "Account"("userId", "archivedAt");
CREATE INDEX "Category_userId_archivedAt_idx" ON "Category"("userId", "archivedAt");
CREATE UNIQUE INDEX "Category_userId_name_key" ON "Category"("userId", "name");
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Transaction_accountId_transactionDate_idx" ON "Transaction"("accountId", "transactionDate");
CREATE INDEX "Transaction_destinationAccountId_transactionDate_idx" ON "Transaction"("destinationAccountId", "transactionDate");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
