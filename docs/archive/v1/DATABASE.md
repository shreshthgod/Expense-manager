# Database

**Provider:** PostgreSQL · **ORM:** Prisma 5.22 · **Schema:** `prisma/schema.prisma` (327 lines)
**Migrations:** ❌ **`prisma/migrations/` does not exist** — the schema is applied with
`prisma db push`, never versioned as SQL (CONFIRMED).

---

## 1. Entity relationship overview

```
                            ┌──────────────┐
                            │     User     │
                            │ id (cuid)    │
                            │ email UNIQUE │
                            └──────┬───────┘
        ┌──────────┬──────────┬────┴─────┬──────────┬───────────┬────────────┐
        ▼          ▼          ▼          ▼          ▼           ▼            ▼
   Profile    UserPreference Account  Category  Transaction  Budget    SavingsGoal
  (1:1,C)       (1:1,C)      (1:n,C) (1:n,C*)  (1:n,C)     (1:n,C)    (1:n,C)
                                                    │           │
                                                    │ SetNull   │ SetNull
                                                    ▼           ▼
                                                 Account     Category
        ▼              ▼             ▼            Category
 RecurringTransaction Notification AIConversation  Account
    (1:n,C)            (1:n,C)       (1:n,C)
        │                                   │
        │ SetNull (accountId, categoryId)   │ Cascade
        ▼                                   ▼
     Transaction ──SetNull──► AIMessage   AIReport (1:n,C)
                                                     AuditLog (1:n, userId SetNull)
```

`C` = `onDelete: Cascade` from `User`. `C*` = `Category.userId` is **optional**, so system
categories can exist without a user. `SetNull` = FK nulled on parent delete.

**Money:** every monetary column is `Decimal @db.Decimal(14, 2)`.
**IDs:** `String @id @default(cuid())` everywhere.
**Timestamps:** `createdAt @default(now())` + `updatedAt @updatedAt` on most tables
(`Notification`, `AIMessage`, `AuditLog` have `createdAt` only).

---

## 2. Models

### 2.1 `User`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid PK | |
| `email` | String `@unique` + `@@index([email])` | stored lowercase by zod |
| `passwordHash` | String | bcrypt, cost 10 |
| `name` | String | 2–80 chars (zod) |
| `avatarUrl` | String? | any URL |
| `onboardedAt` | DateTime? | gates the onboarding wizard |
| `createdAt` / `updatedAt` | DateTime | |

Relations: `profile?`, `preference?`, `accounts[]`, `categories[]`, `transactions[]`,
`budgets[]`, `goals[]`, `recurringTransactions[]`, `notifications[]`, `conversations[]`,
`reports[]`, `auditLogs[]` — all `onDelete: Cascade`.

### 2.2 `Profile`
`id` · `userId @unique` (Cascade) · `monthlyIncome Decimal(14,2)?` · `occupation String?` ·
`timezone String @default("Asia/Kolkata")`

> `monthlyIncome` is written by onboarding/settings and **read by nothing** (CONFIRMED).
> There is no `bio` / `monthlySavingsTarget` field.

### 2.3 `UserPreference`
`id` · `userId @unique` (Cascade) · `currency = "INR"` · `dateFormat = "DD MMM YYYY"` ·
`theme = "system"` · `notifyBudget = true` · `notifyGoal = true` · `notifyAIInsight = true` ·
`notifyRecurring = true`

> `currency`, `dateFormat` and all four `notify*` flags are **written and never read** (CONFIRMED).

### 2.4 `Account`
`id` · `userId` (Cascade, `@@index`) · `name` · `type AccountType` ·
`balance Decimal(14,2) @default(0)` · `currency = "INR"` · timestamps
→ `transactions[]`, `recurringTransactions[]`

`balance` is a **materialised running total**, mutated by:
- `transaction.service.adjustAccountBalance` (EXPENSE −, INCOME +, **TRANSFER 0**)
- `recurring.service.processDueRecurrences` (`± amount * max(1, guard)`)

⚠ Deleting an account nulls `Transaction.accountId` but does **not** recompute anything else.
⚠ There is **no `isArchived` column** despite the feature being conceptually useful.

### 2.5 `Category`
`id` · `name` · `icon?` · `color?` · `type CategoryType @default(BOTH)` ·
`isSystem @default(false)` · `userId?` (Cascade) · timestamps

Indexes/keys: `@@unique([name, isSystem])` · `@@index([userId])` · `@@index([isSystem])`

⚠ **`@@unique([name, isSystem])` is global, not scoped by `userId`.** Two different users cannot
both own a custom (`isSystem=false`) category called "Food" — the second insert raises a Prisma
`P2002` unique violation, which `handleRoute` turns into a 500 `INTERNAL`, not a friendly 409.
The service's own conflict check (`category.service.createCategory`) *is* tenant-scoped, so it
catches the common case but not the race/other-tenant case.

`deleteCategory` blocks deletion when `transaction.count({userId, categoryId}) > 0`, and refuses
to touch system categories. It does **not** check budgets → `Budget.categoryId` becomes `SetNull`.

**Two sources of truth:** `lib/constants/{EXPENSE,INCOME,ALL}_SYSTEM_CATEGORIES` (22 entries, with
icon+colour) drives every UI dropdown, while DB `Category` rows drive relational FKs. They are
never reconciled. `ensureSystemCategories()` in `category.service.ts` would upsert the constants
into the DB — **but it is called from nowhere** (CONFIRMED by grep: only its own definition).

### 2.6 `Transaction`
| Column | Type | Notes |
|---|---|---|
| `id` | cuid | |
| `userId` | String (Cascade) | always filtered |
| `accountId` | String? → `Account` **SetNull** | |
| `categoryId` | String? → `Category` **SetNull** | |
| `type` | `EXPENSE \| INCOME \| TRANSFER` | |
| `amount` | Decimal(14,2) | `> 0`, ≤ 1e12 (zod) |
| `description` / `merchant` / `paymentMethod` / `notes` / `location` | String? | |
| `tags` | `String[] @default([])` | **no UI or service reads/writes it** |
| `transactionDate` | DateTime | |
| `isRecurring` | Boolean = false | |
| `recurringTransactionId` | String? → **SetNull** | |
| timestamps | | |

Indexes: `@@index([userId, transactionDate])`, `[userId, type]`, `[categoryId]`, `[userId, merchant]`

### 2.7 `Budget`
`id` · `userId` (Cascade) · `name` · `amount Decimal(14,2)` · `period BudgetPeriod` ·
`startDate` · `endDate?` · `categoryId?` → `Category` **SetNull** · timestamps
Indexes: `@@index([userId])`, `@@index([userId, startDate])`

**No relation to `Transaction`.** Spending is computed by query predicate:
`type=EXPENSE AND transactionDate BETWEEN startDate AND (endDate ?? today) AND categoryId = ?`.

`period` is stored but **never used** to derive the window (CONFIRMED `budget-status.ts`).

### 2.8 `SavingsGoal`
`id` · `userId` (Cascade) · `name` · `targetAmount Decimal(14,2)` ·
`currentAmount Decimal(14,2) @default(0)` · `deadline DateTime?` ·
`category String?` (**free text, not an FK**) · `description String?` · timestamps
Index: `@@index([userId])`

### 2.9 `RecurringTransaction`
`id` · `userId` (Cascade) · `accountId?` (SetNull) · `categoryId?` (SetNull) ·
`type (EXPENSE|INCOME)` · `amount` · `description?` · `merchant?` ·
`frequency (DAILY|WEEKLY|MONTHLY|YEARLY)` · `nextExecutionDate` · `endDate?` ·
`active = true` · `autoCreate = true` · `lastExecutedAt?` · timestamps
Indexes: `@@index([userId, nextExecutionDate])`, `@@index([userId, active])`

Note: `type` is typed `TransactionType` in Prisma but the create schema narrows it to
`EXPENSE | INCOME` (no `TRANSFER`) — a deliberate restriction (CONFIRMED).

### 2.10 `Notification`
`id` · `userId` (Cascade) · `title` · `message` · `type NotificationType` ·
`read = false` · `link?` · `metadata Json?` · `createdAt`
Indexes: `@@index([userId, read])`, `@@index([userId, createdAt])`

**There is no `dedupeKey` column.** Dedupe is implemented as:
```ts
prisma.notification.findFirst({
  where: { userId, read: false,
           metadata: { path: ["dedupeKey"], equals: input.dedupeKey } }
})
```
and the key is stored as `metadata = { dedupeKey }`. Because the guard filters `read: false`,
a deduped key **re-fires after the notification has been read** (CONFIRMED).

### 2.11 `AIConversation` / `AIMessage`
`AIConversation`: `id`, `userId` (Cascade), `title = "New conversation"`, timestamps,
`@@index([userId, updatedAt])`, `messages[]`
`AIMessage`: `id`, `conversationId` (**Cascade**), `role MessageRole`, `content`,
`toolName?`, `metadata Json?`, `createdAt`, `@@index([conversationId, createdAt])`

⚠ Because the chat page never sends `conversationId`, one conversation row is created per user
message (CONFIRMED).

### 2.12 `AIReport`
`id` · `userId` (Cascade) · `type ReportType` · `startDate` · `endDate` · `title` ·
`summary` · `content Json` · `healthScore Int?` · `metadata Json?` · `createdAt`
Index: `@@index([userId, createdAt])`

There are **no `year`/`month`/`quarter`/`status`/`generatedAt` columns** — the period is inside
`content.period = { label, startDate, endDate }`.

### 2.13 `AuditLog`
`id` · `userId String?` (**nullable, `SetNull`**) · `action String` · `entity String`
(**required**) · `entityId String?` · `metadata Json?` · `createdAt`
Index: `@@index([userId, createdAt])`

**No `ip` column.** Actions are a closed union in `server/services/audit.service.ts`
(18 values, see `PROJECT_INTELLIGENCE.md §22`). Writes are fire-and-forget with error swallowing.

### Full model list (14)
`User, Profile, UserPreference, Account, Category, Transaction, Budget, SavingsGoal,
RecurringTransaction, Notification, AIConversation, AIMessage, AIReport, AuditLog`

---

## 3. Enums (8)

| Enum | Values | Actually written by app code |
|---|---|---|
| `TransactionType` | EXPENSE, INCOME, TRANSFER | all three (TRANSFER rarely, no money movement) |
| `BudgetPeriod` | MONTHLY, WEEKLY, YEARLY, CUSTOM | all four (onboarding hardcodes MONTHLY) |
| `RecurrenceFrequency` | DAILY, WEEKLY, MONTHLY, YEARLY | all four |
| `AccountType` | CASH, BANK, SAVINGS, CREDIT_CARD, WALLET, INVESTMENT | seeded: BANK, CREDIT_CARD, CASH, INVESTMENT |
| `CategoryType` | EXPENSE, INCOME, BOTH | EXPENSE/INCOME by constants; `BOTH` is the schema default |
| `NotificationType` | BUDGET_THRESHOLD, BUDGET_EXCEEDED, GOAL_DEADLINE, UNUSUAL_TRANSACTION, **RECURRING_UPCOMING, AI_RECOMMENDATION**, REPORT_GENERATED | only the first four + REPORT_GENERATED (last two have no producer) |
| `MessageRole` | USER, ASSISTANT, SYSTEM, TOOL | USER/ASSISTANT (+SYSTEM/TOOL if the agent emits them) |
| `ReportType` | MONTHLY, QUARTERLY, YEARLY, SPENDING_ANALYSIS, BUDGET, SAVINGS, FINANCIAL_HEALTH | only the first three (`mapType` passes through) |

---

## 4. Cascade & integrity matrix

| Parent deleted | Child effect |
|---|---|
| `User` | everything Cascade-deleted (profile, preference, accounts, categories, transactions, budgets, goals, recurring, notifications, conversations, reports) — **except `AuditLog`, which keeps its row with `userId = NULL`** |
| `Account` | `Transaction.accountId → NULL`, `RecurringTransaction.accountId → NULL`; balances of other accounts unaffected |
| `Category` | `Transaction.categoryId → NULL`, `Budget.categoryId → NULL`, `RecurringTransaction.categoryId → NULL` |
| `RecurringTransaction` | `Transaction.recurringTransactionId → NULL` |
| `AIConversation` | all `AIMessage` rows Cascade-deleted |

Deletion helpers consistently use `deleteMany({ id, userId })` + `count === 0 → 404`, or
`findFirst({ id, userId })` before `delete`.

**No DB-level foreign key enforces `Transaction.userId === Category.userId`** — a user could
theoretically reference another tenant's `categoryId` if the API didn't validate. The API always
supplies `userId` in the same scope, but `transactionCreateSchema` accepts any valid cuid (INFERRED
risk, not demonstrated).

---

## 5. Index strategy

| Table | Indexes |
|---|---|
| `User` | `email` (unique + explicit index — redundant but harmless) |
| `Account` | `userId` |
| `Category` | `name+isSystem` (unique), `userId`, `isSystem` |
| `Transaction` | `userId+transactionDate`, `userId+type`, `categoryId`, `userId+merchant` |
| `Budget` | `userId`, `userId+startDate` |
| `SavingsGoal` | `userId` |
| `RecurringTransaction` | `userId+nextExecutionDate`, `userId+active` |
| `Notification` | `userId+read`, `userId+createdAt` |
| `AIConversation` | `userId+updatedAt` |
| `AIMessage` | `conversationId+createdAt` |
| `AIReport` | `userId+createdAt` |
| `AuditLog` | `userId+createdAt` |
| `Profile`, `UserPreference` | PK + unique `userId` |

Analysis queries frequently filter `userId + transactionDate + type` — covered (CONFIRMED).
Raw SQL in `health-score/forecast/affordability` filters `userId + transactionDate + type` — covered.

**Missing:** no index on `Transaction.transactionDate` alone (range scans across tenants are always
`userId`-scoped, so this is fine).

---

## 6. Seeding — `prisma/seed.ts` (519 lines)

Run with `npm run db:seed` (`tsx prisma/seed.ts`).

**⚠ Destructive:** the script begins with `deleteMany()` on **every model including `User`** — it
wipes the entire database, not just the demo tenant (CONFIRMED).

Creates:

| Entity | Detail |
|---|---|
| User | `demo@expensemanager.in` / password **`Demo@123`** (bcrypt hash embedded) |
| UserPreference | defaults |
| Profile | `monthlyIncome: 85000`, occupation set |
| Categories | all system names — but **typed `EXPENSE` even for Salary/Freelance/Business/Interest/Gift/Other Income**, and with `icon: null, color: null` (mismatch vs `lib/constants`, which marks them `INCOME` with colours) |
| Accounts | 4 (HDFC Savings, ICICI Credit, Cash, Zerodha) |
| Transactions | ~6 months of realistic Indian merchants |
| Budgets | 4 monthly budgets, each with a real `categoryId` |
| SavingsGoals | 5, each with `category` but **no `description`** → cannot be edited from the UI |
| Recurring | 4 (Netflix, Spotify, Airtel, Rent) |
| Notifications | 6 |
| AIConversation | 1 |

Redundancy: `const PASSWORD = "Demo@1234"` at the top of the file is **never used** (CONFIRMED);
the README's `Demo@123` is correct.

---

## 7. Migration story

| Command | Status |
|---|---|
| `npm run db:push` | the de-facto way to apply the schema |
| `npm run db:migrate` (`prisma migrate dev`) | would create the first `prisma/migrations/` — none exists yet |
| `prisma migrate deploy` | not usable in CI today (no migration files) |
| `prisma generate` | run automatically inside `npm run build` |

**Recommendation for any future work:** create an initial migration (`prisma migrate diff`) before
the first schema change, otherwise there is no reproducible baseline for other environments.

---

## 8. Live database state (2026-09-27)

```
Can't reach database server at `localhost:5432`
```
No PostgreSQL instance was running during this analysis, so **no live row counts, no runtime
verification, and no `EXPLAIN` checks** were performed. Everything above is derived from the
schema, the services, and the seed script. **UNKNOWN:** actual production/dev row volumes.
