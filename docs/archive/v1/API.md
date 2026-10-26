# API Reference

35 route files · **55 HTTP handlers** · all `export const runtime = "nodejs"`.
Every handler: `requireUserId()` → `zod.parse` → service → `handleRoute` envelope.

**Envelope** (`lib/api/response.ts`)

```jsonc
{ "success": true,  "data": <T>, "message": "..." }        // 200 / 201
{ "success": false, "error": { "code": "...", "message": "...", "details": [...] } }
```

**Status codes:** 200 OK · 201 Created · 400 `VALIDATION_ERROR` / `ApiError.badRequest` ·
401 `UNAUTHORIZED` · 403 `FORBIDDEN` · 404 `NOT_FOUND` · 409 `CONFLICT` ·
429 `TOO_MANY_REQUESTS` · 500 `INTERNAL`.

**Auth:** bearer-less. Session cookie `em_session` (httpOnly, SameSite=Lax).
**Middleware does not cover `/api`** — protection is per handler.

---

## 1. Auth

| Method | Path | Body / Query | Success | Notes |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{name 2-80, email, password 8-128 + letter + digit}` | 200 `{id,name,email,onboardedAt}` | 10/min/IP · 409 on duplicate · creates `User`+`UserPreference`+`Profile` · audit `REGISTER` |
| POST | `/api/auth/login` | `{email, password}` | 200 same shape | 15/min/IP · 401 `INVALID_CREDENTIALS` · audit `LOGIN` |
| POST | `/api/auth/logout` | — | 200 | deletes cookie |

---

## 2. User, onboarding, preferences

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| POST | `/api/onboarding` | `{monthlyIncome?, occupation?, categoryNames[], account?, budget?, goal?}` | `{onboardedAt}` | sets `onboardedAt`; creates profile rows, categories, optional account/budget/goal. **Page never sends `account`/`occupation`.** No audit. |
| GET | `/api/profile` | — | user + `profile` + `preference` | |
| PATCH | `/api/profile` | `{name?, avatarUrl?}` | user subset | `avatarUrl` nullable |
| PUT | `/api/profile` | `{currentPassword, newPassword}` | `{changed:true}` | 400 `WRONG_PASSWORD` · audit `PASSWORD_CHANGED` |
| GET | `/api/preferences` | — | preference (upserts defaults) | |
| PATCH | `/api/preferences` | `{currency?, dateFormat?, theme?, notifyBudget?, notifyGoal?, notifyAIInsight?, notifyRecurring?}` | preference | `currency ∈ INR/USD/EUR/GBP`, `dateFormat ∈ DD MMM YYYY / MM/DD/YYYY / YYYY-MM-DD`, `theme ∈ light/dark/system`. **All except `theme` are inert.** |
| DELETE | `/api/account` | — | `{deleted:true}` | ⚠ deletes the `User` row (cascade wipes everything). **No password check, no audit call, session cookie not cleared.** UI never calls it. |

---

## 3. Transactions

### `GET /api/transactions`

Query (zod `transactionQuerySchema`, all optional except defaults):

| Param | Type | Notes |
|---|---|---|
| `page` | int ≥1 | default 1 |
| `pageSize` | 20 \| 50 \| 100 | default 20, **refined set** |
| `search` | string ≤120 | |
| `type` | `EXPENSE\|INCOME\|TRANSFER` | |
| `categoryId` | **cuid** | page sends a name → 400 (bug) |
| `accountId` | cuid | |
| `merchant` | string ≤120 | |
| `minAmount` / `maxAmount` | number | |
| `startDate` / `endDate` | coercible date | |
| `sortBy` | `transactionDate`\|`amount`\|`createdAt` | default `transactionDate` |
| `sortDir` | `asc`\|`desc` | default `desc` |

Returns `{ items, total, page, pageSize }`.

### `POST /api/transactions`
```jsonc
{
  "type": "EXPENSE" | "INCOME" | "TRANSFER",   // default EXPENSE
  "amount": >0,                                 // required
  "description?": "", "merchant?": "", "paymentMethod?": "",
  "notes?": "", "location?": "",
  "transactionDate": <date>,                    // required
  "accountId?": cuid|null, "categoryId": cuid|null,   // REQUIRED (refine)
  "isRecurring": false, "recurringTransactionId?": cuid|null
}
```
→ 201 · audit `CREATE_TRANSACTION` · side effects: `Account.balance` adjust,
`afterExpenseCreated` (budget threshold + anomaly notifications, errors swallowed).

> **The `/transactions` and `/income` pages send `categoryId` as a category NAME → 400.**
> See `KNOWN_ISSUES.md` B1/B2.

### `GET /api/transactions/[id]` → mapped DTO · `PATCH` (`transactionUpdateSchema` = base `.partial()`) → audit `UPDATE_TRANSACTION` · `DELETE` → audit `DELETE_TRANSACTION`, reverses balance.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/transactions/[id]/duplicate` | copies the row · audit `CREATE_TRANSACTION` · **no UI** |
| POST | `/api/transactions/import` | body `{rows: transactionBase[] (≤2000), accountId: cuid}` · audit `IMPORT_TRANSACTIONS` · **no UI** |

---

## 4. Income

| Method | Path | Notes |
|---|---|---|
| GET | `/api/income?…` | same query schema, **forces `type: "INCOME"`** |
| POST | `/api/income` | same body as `POST /api/transactions`, **forces `type: "INCOME"`** |

---

## 5. Accounts

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| GET | `/api/accounts` | — | array | read by transaction form + dashboard |
| POST | `/api/accounts` | `{name 1-80, type, balance?=0, currency="INR"}` | 201 | audit `CREATE_ACCOUNT` · **no UI** |
| PATCH | `/api/accounts/[id]` | same `.partial()` | 200 | **no UI**, no audit |
| DELETE | `/api/accounts/[id]` | — | 200 | audit `DELETE_ACCOUNT` · FKs `SetNull` · **no UI** |

`type ∈ CASH|BANK|SAVINGS|CREDIT_CARD|WALLET|INVESTMENT` · `balance ∈ [-1e12, 1e12]`.

---

## 6. Categories

| Method | Path | Body | Success | Notes |
|---|---|---|---|---|
| GET | `/api/categories` | — | `[{id,name,icon,color,type,isSystem,userId}]` | returns system + own · **no UI** |
| POST | `/api/categories` | `{name 1-60, icon?, color? (#[0-9a-f]{6}), type=EXPENSE\|INCOME\|BOTH}` | 201 | conflict check (case-insensitive) → 409 · **no UI** |
| PATCH | `/api/categories/[id]` | `categoryCreateSchema.partial()` | 200 | system categories → 403 · **no UI** |
| DELETE | `/api/categories/[id]` | — | 200 | system → 403; used by transactions → 400 with count · **no UI** |

⚠ `Category` has a **global** `@@unique([name, isSystem])`, so a second tenant creating the same
custom name yields an unhandled Prisma `P2002` → 500.

---

## 7. Budgets

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/budgets` | — | `BudgetStatus[]` with `spent`, `remaining`, `utilization` |
| POST | `/api/budgets` | `{name 1-80, amount>0, period, startDate, endDate?, categoryId?: cuid\|null}` | 201 · audit `CREATE_BUDGET` |
| PATCH | `/api/budgets/[id]` | `{name?, amount?, period?, startDate?, endDate?, categoryId?: cuid}` | 200 · audit `UPDATE_BUDGET` |
| DELETE | `/api/budgets/[id]` | — | 200 · audit `DELETE_BUDGET` |

- `period ∈ WEEKLY|MONTHLY|YEARLY|CUSTOM`; `.refine` requires `endDate` when `period = "CUSTOM"`.
- **PATCH defines its own inline `budgetUpdateSchema`** whose `categoryId` is
  `z.string().cuid().optional()` — **`null` is rejected**, so the UI's edit always 400s.
- `GET` accepts **no query parameters** (no period/date filter).

---

## 8. Savings goals

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/goals` | — | `GoalStatus[]` (progress, daysRemaining, overdue, requiredMonthlySaving) |
| POST | `/api/goals` | `goalCreateSchema` `{name, targetAmount>0, currentAmount?=0, deadline?: date\|null, category?, description?}` | 201 · audit `CREATE_GOAL` |
| PATCH | `/api/goals/[id]` | **inline route schema** `{name?, targetAmount?, currentAmount?, deadline?: date, category?, description?, addContribution?>0}` | 200 · audit `UPDATE_GOAL` |
| DELETE | `/api/goals/[id]` | — | 200 · audit `DELETE_GOAL` |

- `POST` uses `lib/validation/schemas.ts::goalCreateSchema` where `category`/`description` are
  `optionalTrimmed()` → **`null` is rejected**.
- `PATCH` uses an **inline schema in the route file** with `deadline: z.coerce.date().optional()`
  (no `null` branch) → `deadline: null` becomes **1970-01-01**, and `category: null` /
  `description: null` are rejected.
- `addContribution` is the mechanism behind the "Contribute" dialog.

---

## 9. Recurring transactions — **no UI**

| Method | Path | Body |
|---|---|---|
| GET | `/api/recurring` | — → `RecurringDTO[]` |
| POST | `/api/recurring` | `{type EXPENSE\|INCOME, amount>0, frequency, nextExecutionDate, endDate?, merchant?, description?, categoryId?, accountId?, autoCreate=true}` |
| PATCH | `/api/recurring/[id]` | partial + `active?` |
| DELETE | `/api/recurring/[id]` | — |

No audit actions are written for recurring (none of the 18 `AuditAction` values cover it).
Materialisation happens inside `GET /api/dashboard`, not here.

---

## 10. Notifications

| Method | Path | Body / Query | Success |
|---|---|---|---|
| GET | `/api/notifications` | `page`, `pageSize` (**raw `Number()`, not zod-validated**) | `{items, total, unreadCount, page, pageSize}` |
| PATCH | `/api/notifications` | — | `{updated:true}` mark **all** read · **no UI caller** |
| POST | `/api/notifications/read-all` | — | identical to `PATCH` · **this is the one the UI calls** |
| DELETE | `/api/notifications/[id]` | — | `{deleted:true}` — **the UI calls this for "mark as read"** |

There is **no `PATCH /api/notifications/[id]`**, even though
`notification.service.markNotificationRead()` exists and is imported by **zero** routes.

---

## 11. Dashboard & analytics

| Method | Path | Query | Success |
|---|---|---|---|
| GET | `/api/dashboard` | — | `DashboardData` (see below) · **also runs recurring materialisation + goal-deadline checks** |
| GET | `/api/analytics/summary` | `preset`, `startDate?`, `endDate?` | income/expenses/net/savingsRate + previous-range + deltas |
| GET | `/api/analytics/categories` | same | category breakdown |
| GET | `/api/analytics/trends` | `months` int 1–24 (default 6) | monthly series |

`preset ∈ this_week | this_month | last_month | 3_months | 6_months | this_year | custom`

**`DashboardData`** — `{ totalBalance, summary, categoryBreakdown, monthlyTrend, budgets,
recentTransactions[8], accounts, unreadNotifications, hasAnyData }`

---

## 12. Export

| Method | Path | Query | Result |
|---|---|---|---|
| GET | `/api/export` | `type=transactions` | CSV `date,type,category,merchant,description,amount,paymentMethod`, ≤10,000 rows, `Content-Disposition: attachment` |
| GET | `/api/export` | `type=budgets` | CSV `name,category,amount,period,spent,remaining,utilization` — **no UI link** |
| GET | `/api/export` | anything else | 400 `INVALID_TYPE` |

CSV escaping: fields containing `,` `"` or newline are double-quoted with inner quotes doubled.

---

## 13. AI

| Method | Path | Body | Result | UI |
|---|---|---|---|---|
| POST | `/api/ai/chat` | `{message 1-2000, conversationId?: cuid}` | agent response | `/ai` — **never sends `conversationId`** |
| GET | `/api/ai/insights` | — | `getDashboardInsight(userId)` (deterministic packet) | ❌ none |
| POST | `/api/ai/analyze` | `{amount>0, itemName?}` | `evaluateAffordability(...)` — **deterministic, no LLM** | ❌ none |
| GET | `/api/ai/reports` | — | `StoredReport[]` | `/reports` |
| POST | `/api/ai/reports` | `{type, year, month?, quarter?}` | 201 generated report | `/reports` |
| GET | `/api/ai/reports/[id]` | — | full report incl. `content` | ❌ none |
| DELETE | `/api/ai/reports/[id]` | — | `{deleted:true}` | `/reports` |

Chat rate limit: **20/min per userId**. Other AI routes are unlimited.
`reportGenerateSchema` enforces `month` for `MONTHLY` and `quarter` for `QUARTERLY`.

---

## 14. Rate limits summary

| Key | Limit | Window | Route |
|---|---:|---:|---|
| `login:<x-forwarded-for ?? "local">` | 15 | 60 s | `POST /api/auth/login` |
| `register:<x-forwarded-for ?? "local">` | 10 | 60 s | `POST /api/auth/register` |
| `ai:chat:<userId>` | 20 | 60 s | `POST /api/ai/chat` |

Implementation: in-memory `Map<string, number[]>` sliding window; throws
`ApiError.tooManyRequests()` **inside** `handleRoute`, so 429 is JSON-shaped. No `Retry-After`.
No limits on data-mutating or export endpoints.

---

## 15. Audit actions written by routes

`REGISTER` · `LOGIN` · `CREATE_TRANSACTION` · `UPDATE_TRANSACTION` · `DELETE_TRANSACTION` ·
`IMPORT_TRANSACTIONS` · `CREATE_BUDGET` · `UPDATE_BUDGET` · `DELETE_BUDGET` ·
`CREATE_GOAL` · `UPDATE_GOAL` · `DELETE_GOAL` · `CREATE_ACCOUNT` · `DELETE_ACCOUNT` ·
`PASSWORD_CHANGED`

**Never written despite being declared:** `LOGOUT`, `AI_REPORT_GENERATED`, `ACCOUNT_DELETED`.
**Missing entirely (no declared value):** category create/update/delete, recurring create/update/delete,
onboarding, preferences update, account `PATCH`.

---

## 16. Endpoints with no UI caller (11)

`GET /api/ai/insights` · `POST /api/ai/analyze` · `GET /api/ai/reports/[id]` ·
`GET /api/categories` · `POST /api/categories` · `PATCH /api/categories/[id]` ·
`DELETE /api/categories/[id]` · `POST /api/accounts` · `PATCH /api/accounts/[id]` ·
`DELETE /api/accounts/[id]` · `GET|POST|PATCH|DELETE /api/recurring*` (4) ·
`POST /api/transactions/import` · `POST /api/transactions/[id]/duplicate` ·
`GET /api/export?type=budgets` · `DELETE /api/account` · `PATCH /api/notifications`
(the UI uses the duplicate `POST /api/notifications/read-all` instead).

> **Backward-compat note:** `GET /api/categories` *is* imported nowhere in `app/` — but
> `listCategories` is used internally by `onboarding`. The HTTP route itself is unused.
