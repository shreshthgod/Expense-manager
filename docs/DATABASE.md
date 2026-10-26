# Database (v2)

PostgreSQL 16 · Prisma 5.22 · 32 models · versioned SQL migrations in `prisma/migrations` (apply with `npx prisma migrate deploy`).

## Migrations

| Migration | What it does |
|---|---|
| `0001_baseline` | The v1 schema exactly as deployed with `db push`, so existing databases can be baselined (`prisma migrate resolve --applied 0001_baseline`). |
| `0002_core_repair` | Per-user categories (copies system categories to every user and remaps references); account opening balances derived from existing data; financial dates converted to `DATE` in Asia/Kolkata; transaction status/soft delete/version/transfer destination; `CHECK` constraints (amount > 0, transfer and adjustment shape); notification dedupe keys (backfilled); open-ended budgets; sessions, idempotency records, outbox, rate-limit buckets. |
| `0003_recurring_schedules` | Recurring kinds (standard/bill/subscription), intervals, start dates (backfilled), occurrences (existing recurring transactions linked as RECORDED). |
| `0004_financial_domain` | Splits, refunds, merchants and aliases, automation rules, attachments, reconciliations, import jobs/mappings, transaction templates, credit-card fields; `CHECK`s for refund shape, last-4 digits and day ranges. |
| `0005_planning` | Budget rollover and templates, goal kinds and contribution ledger (opening contribution = existing saved amount), financial snapshots, conversation pinning, extra preferences. |

All five were tested against a copy of a v1 database with real-shaped data; `prisma migrate diff` between migrations and schema is empty (checked in CI).

## Models

| Group | Models |
|---|---|
| Identity | `User`, `Session`, `Profile`, `UserPreference`, `AuditLog` |
| Ledger | `Account`, `Category`, `Transaction`, `TransactionSplit`, `Merchant`, `MerchantAlias`, `AutomationRule`, `TransactionTemplate`, `Attachment`, `AttachmentBlob`, `Reconciliation`, `ImportJob`, `ImportMapping` |
| Planning | `Budget`, `BudgetTemplate`, `SavingsGoal`, `GoalContribution`, `RecurringTransaction`, `RecurringOccurrence`, `FinancialSnapshot` |
| Communication | `Notification`, `AIConversation`, `AIMessage`, `AIReport` |
| Infrastructure | `IdempotencyRecord`, `OutboxEvent`, `RateLimitBucket` |

## Invariants enforced by the database

- `Transaction.amount > 0`; transfers have both accounts and they differ; adjustments have exactly one side; refunds reference an original expense.
- `UNIQUE(userId, name)` on categories, merchants, templates and budget templates; `UNIQUE(userId, pattern)` on merchant aliases.
- `UNIQUE(recurringId, dueDate)` on occurrences; `UNIQUE(transactionId)` on occurrences.
- `UNIQUE(importJobId, importRowIndex)` on transactions (retry-safe imports).
- `UNIQUE(userId, dedupeKey)` on notifications; `UNIQUE(userId, periodStart)` on snapshots.
- Card `maskedNumber` is exactly 4 digits; statement/payment days are 1–31.
- Every user-owned row cascades on user deletion.

## Invariants enforced by services (and verified by tests)

- `Account.balance = openingBalance + Σ posted, non-deleted effects` (`verifyLedger`, `rebuildBalances`).
- `SavingsGoal.currentAmount = Σ GoalContribution.amount ≥ 0` (`verifyGoalLedger`).
- Split lines sum to the transaction amount; refunds never exceed the purchase.

## Seed

`npm run db:seed` creates or refreshes only the demo user `demo@expensemanager.in` / `Demo@1234` (six months of Indian-context data: accounts incl. a credit card, bills, subscriptions, budgets incl. rollover, goals with contribution history). It refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true`.
