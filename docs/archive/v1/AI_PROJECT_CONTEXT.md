# AI PROJECT CONTEXT

> **Purpose:** a single self-contained brief so a future AI agent can work on `expense-manager`
> without re-deriving the codebase. Contains two parts:
> **Part A — MASTER PROJECT CONTEXT FOR FUTURE AI** (narrative brief).
> **Part B — PROJECT SPECIFICATION** (machine-friendly, structured).
> Companion documents in this folder carry the detail.

**Generated:** 2026-09-27 · **Source:** read-only analysis of `/home/makan/A-015`.
**Verification performed:** `tsc --noEmit` (0 errors) · `next lint` (0 errors, 1 warning) ·
`vitest run` (5 files / 67 tests pass) · targeted zod execution against `node_modules/zod@3.25.76`.
**Not verified:** runtime behaviour against PostgreSQL (server unreachable), live AI provider calls.

---

# PART A — MASTER PROJECT CONTEXT FOR FUTURE AI

## A1. What this project is

`expense-manager` (v1.0.0, private npm package) is a **single-user personal finance web app for
India**, built with Next.js 14 App Router + PostgreSQL + Prisma. It has conventional CRUD
(accounts, categories, transactions, budgets, savings goals, recurring rules, notifications) and a
layer of **deterministic analytics** (summary, category breakdown, trends, budget utilisation,
anomaly detection, forecast, affordability, a weighted financial health score) plus an
**AI agent pipeline** for chat and report narration.

Currency is **INR**, locale **`en-IN`**, both hardcoded in `lib/utils/format.ts`.

## A2. The single most important design principle

> **Numbers are computed in `server/analytics/*`; the AI only narrates them.**

This is stated verbatim in `server/analytics/health-score.ts`, `forecast.ts`, `affordability.ts`
and across `agents/`. Never introduce a code path where a model produces a figure. If you add an
AI feature, compute the value first and pass it to the model as input.

## A3. Architecture in five lines

```
app/(app)/**  (all "use client")  --fetch-->  app/api/**/route.ts
                                               ├─ requireUserId()        lib/api/auth.ts
                                               ├─ zod.parse              lib/validation/schemas.ts
                                               ├─ handleRoute()          lib/api/response.ts
                                               └─ server/services/**     business logic (userId-scoped)
                                                     └─ server/analytics/**   pure calculations
Prisma singleton: lib/db/prisma.ts   ·   middleware.ts guards PAGES ONLY (not /api)
```

**Hard rules that already hold and must keep holding:**
1. `server/**` never imports `Request`/`Response`/React.
2. Every API handler calls `await requireUserId()`.
3. Every Prisma query is filtered by `userId` (or uses `deleteMany({id, userId})` + 404).
4. Raw SQL uses `Prisma.sql` / `$queryRaw` tagged templates only — never string concatenation.
5. Response envelope is always `{success:true,data,message?}` or
   `{success:false,error:{code,message,details?}}`.

## A4. Where things live

| Need | Look in |
|---|---|
| A page | `app/(app)/<name>/page.tsx` (all client components) |
| An endpoint | `app/api/<path>/route.ts` |
| Business rules | `server/services/*.service.ts` |
| A formula | `server/analytics/*.ts` |
| Validation | `lib/validation/schemas.ts` **and** inline schemas inside `app/api/budgets/[id]/route.ts`, `app/api/goals/[id]/route.ts`, `app/api/analytics/trends/route.ts` |
| Design tokens | `app/globals.css` + `tailwind.config.ts` |
| Static reference data | `lib/constants/index.ts` |
| Money/date helpers | `lib/utils/money.ts`, `lib/utils/format.ts` |
| Schema | `prisma/schema.prisma` |
| AI orchestration | `agents/agent-runner.ts` → intent / planner / tools / analysis / decision / report |
| Tests | `tests/*.test.ts` (vitest, pure functions only) |

## A5. Current state — be careful here

**Green:** `tsc --noEmit` clean · `next lint` clean (1 `<img>` warning) · 67/67 tests pass.

**Red — the app is currently not usable end-to-end.** Seven runtime bugs, all root-caused and
reproduced (see `KNOWN_ISSUES.md`):

1. **The UI sends category *names* where the API demands `cuid`s.** This breaks Add/Edit
   Transaction, Add Income, category filtering, and Create Budget-with-category.
2. **Edit Budget always 400** — the inline `budgetUpdateSchema` in
   `app/api/budgets/[id]/route.ts` lacks `.or(z.literal(null))`.
3. **Create/Edit Goal fails** unless category *and* description are non-null (description is
   labelled "Optional"); a cleared deadline coerces to **1970-01-01** via `z.coerce.date()`.
4. **Notification "mark as read" calls DELETE** — it destroys the record, even though the correct
   `markNotificationRead()` service function exists and is imported by no route.
5. **No UI exists to create an Account** → Total Balance is permanently ₹0 for real users, and
   there is no way to attach transactions to accounts.
6. **AI chat never sends `conversationId`** → a new conversation row per message, no history.
7. **`date` → `null` handling is inconsistent between `lib/validation/schemas.ts` and the inline
   route schemas**, which is also why unit tests don't catch any of this.

**Root causes to fix structurally, not symptomatically:**
- **S1 — dual source of truth for categories:** `lib/constants/*_CATEGORIES` drives every
  dropdown; `Category` rows drive FKs. They are never reconciled, and `ensureSystemCategories()`
  is never called.
- **S2 — dual source of truth for validation:** shared zod schemas *and* inline route schemas
  have drifted. Tests only cover the shared ones.
- **S3 — no integration tests:** 67 tests cover pure functions only. Nothing invokes a route or a
  page payload.

## A6. Dead surface you may be tempted to reuse

Endpoints with **zero UI callers**: `/api/ai/insights`, `/api/ai/analyze`, `/api/categories`
(GET/POST/PATCH/DELETE), `/api/accounts` (POST/PATCH/DELETE), `/api/recurring` (all 4),
`/api/transactions/import`, `/api/transactions/[id]/duplicate`, `/api/export?type=budgets`,
`/api/ai/reports/[id]` (GET), `/api/account` (DELETE), `/api/notifications/read-all`.

Stored-but-unused fields: `UserPreference.currency`, `.dateFormat`, `.notifyBudget/Goal/
AIInsight/Recurring`; `Profile.monthlyIncome`; `Transaction.tags`; `Budget.period`;
`DashboardData.hasAnyData`; `Notification.link`; `NEXT_PUBLIC_APP_URL`.

Dead code: `app/(marketing)/layout.tsx`, `components/ui/textarea.tsx`, `components/ui/tooltip.tsx`,
`date-fns` dependency, `BUDGET_ALERT_THRESHOLDS`, `ensureSystemCategories()`,
`notification.service.markNotificationRead()`, `forecast.ts`'s `void budgetStatuses`,
`health-score.ts`'s empty `if`, `seed.ts`'s `PASSWORD` const, unused enum members
(`ReportType.SPENDING_ANALYSIS|BUDGET|SAVINGS|FINANCIAL_HEALTH`,
`NotificationType.RECURRING_UPCOMING|AI_RECOMMENDATION`,
`AuditAction.LOGOUT|AI_REPORT_GENERATED|ACCOUNT_DELETED`).

## A7. Security context (read `SECURITY.md` before touching auth)

Critical: `lib/auth/jwt.ts` falls back to a **hardcoded `AUTH_SECRET`** if the env var is absent.
Sessions are 30-day non-revocable JWTs — password change does not invalidate them.
`next@14.2.35` has 1 critical + 1 high advisories. `DELETE /api/account` needs no password.
Middleware excludes `/api`, so handler-level `requireUserId()` is the only API protection.
Rate limiting is in-memory and keys off a spoofable `x-forwarded-for`.

## A8. How to work here

```
npm run typecheck     # tsc --noEmit         — must stay 0 errors
npm run lint          # next lint            — must stay 0 errors
npm test              # vitest run           — must stay 67+ passing (add tests)
npm run db:seed       # ⚠ WIPES THE ENTIRE DATABASE (all tenants)
npm run dev           # requires PostgreSQL on localhost:5432
```

There is **no git repository**, **no CI**, **no `prisma/migrations/`**, and the local DB was down
during analysis. Create the first migration before changing the schema.

**Conventions to imitate:** service functions take `(userId, input)`; errors via
`ApiError.<method>()`; mutations call `audit({...})` afterwards; pages use
`fetch → res.json() → if (!data.success) addToast(error.message, "error")`; UI primitives come from
`components/ui/*` with `cn()` class merging; Tailwind tokens are CSS variables
(`bg-primary`, `text-muted-foreground`, `border-border`, `text-success`, `text-warning`).

## A9. Do not

- Do not let a model compute a number.
- Do not change an API schema without changing every page that calls it (and vice versa).
- Do not add a route handler without `requireUserId()` + `handleRoute()`.
- Do not run `db:seed` against non-demo data.
- Do not assume `/api` is protected by middleware — it is not.
- Do not refactor while fixing; fix, test, then refactor separately.

---

# PART B — PROJECT SPECIFICATION

## B1 · Identity

```yaml
name: expense-manager
version: 1.0.0
description: AI-powered personal finance platform
private: true
package_manager: npm
language: TypeScript 5.7 (strict)
node_target: not specified in package.json
license: null
repository: null
git_repo: false
```

## B2 · Scripts

| Script | Command |
|---|---|
| `dev` | `next dev` |
| `build` | `prisma generate && next build` |
| `start` | `next start` |
| `lint` | `next lint` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `db:migrate` | `prisma migrate dev` |
| `db:push` | `prisma db push` |
| `db:seed` | `tsx prisma/seed.ts` |
| `db:studio` | `prisma studio` |

## B3 · Dependency inventory

**runtime:** `next ^14.2.21` (14.2.35 installed) · `react`/`react-dom ^18.3.1` ·
`@prisma/client ^5.22.0` · `zod ^3.24.1` (3.25.76) · `jose ^5.9.6` (5.10.0) ·
`bcryptjs ^2.4.3` · `recharts ^2.15.0` · `framer-motion ^11.15.0` · `lucide-react ^0.468.0` ·
`next-themes ^0.4.6` · `tailwind-merge ^2.5.5` · `clsx ^2.1.1` ·
`class-variance-authority ^0.7.1` · `@radix-ui/react-slot ^1.3.3` · `@radix-ui/react-label ^2.1.15` ·
`date-fns ^3.6.0` ⚠ **unused**
**dev:** `typescript ^5.7.2` · `vitest ^2.1.8` · `eslint ^8.57.1` + `eslint-config-next` ·
`prisma ^5.22.0` · `tailwindcss ^3.4.17` · `autoprefixer` · `postcss` · `tsx ^4.19.2` ·
`@types/{node,react,react-dom,bcryptjs}`
**npm audit (prod):** 2 vulnerabilities — 1 critical, 1 high (`next`, bundled `postcss`)

## B4 · Environment variables

| Name | Consumer | Required | Fallback |
|---|---|---|---|
| `DATABASE_URL` | `lib/db/prisma.ts` | yes | none |
| `AUTH_SECRET` | `lib/auth/jwt.ts` | **should be** | ⚠ hardcoded dev string |
| `AI_API_KEY` | `agents/provider.ts` | for AI | none |
| `AI_MODEL` | `agents/provider.ts` | for AI | none |
| `AI_BASE_URL` | `agents/provider.ts` | for AI | none |
| `NEXT_PUBLIC_APP_URL` | (unused) | no | — |

`.env` is gitignored but present on disk.

## B5 · Stack

```yaml
framework: Next.js 14 App Router
api: Route Handlers, runtime = "nodejs" on all
rendering: server layouts; 100% of app pages are "use client"
styling: Tailwind 3.4 + CSS-variable tokens, darkMode: "class"
components: custom shadcn-style primitives + Radix Slot/Label, CVA
icons: lucide-react
animation: framer-motion
charts: recharts
theme: next-themes
database: PostgreSQL via Prisma 5.22
auth: JWT (jose, HS256) in httpOnly cookie + bcryptjs(10)
validation: zod
tests: vitest (unit only)
currency/locale: INR / en-IN (hardcoded)
```

## B6 · Routes — pages

| Path | File | Auth | Group |
|---|---|---|---|
| `/` | `app/page.tsx` | public | — |
| `/login` | `app/(auth)/login/page.tsx` | public (redirect if session) | `(auth)` |
| `/register` | `app/(auth)/register/page.tsx` | public (redirect if session) | `(auth)` |
| `/onboarding` | `app/onboarding/page.tsx` | protected | — |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | protected | `(app)` |
| `/transactions` | `app/(app)/transactions/page.tsx` | protected | `(app)` |
| `/income` | `app/(app)/income/page.tsx` | protected | `(app)` |
| `/budgets` | `app/(app)/budgets/page.tsx` | protected | `(app)` |
| `/goals` | `app/(app)/goals/page.tsx` | protected | `(app)` |
| `/analytics` | `app/(app)/analytics/page.tsx` | protected | `(app)` |
| `/ai` | `app/(app)/ai/page.tsx` | protected | `(app)` |
| `/reports` | `app/(app)/reports/page.tsx` | protected | `(app)` |
| `/notifications` | `app/(app)/notifications/page.tsx` | protected | `(app)` |
| `/settings` | `app/(app)/settings/page.tsx` | protected | `(app)` |

`middleware.ts` protected prefixes (11): dashboard, transactions, income, budgets, goals,
analytics, ai, reports, notifications, settings, onboarding.
`AUTH_PAGES` = `/login`, `/register` → redirect to `/dashboard` when session present.
Matcher excludes `api`, `_next/static`, `_next/image`, `favicon.ico`, image extensions.

## B7 · Routes — API (36 files / 55 handlers)

```
AUTH        POST /api/auth/register · POST /api/auth/login · POST /api/auth/logout
USER        POST /api/onboarding
            GET|PATCH|PUT /api/profile
            GET|PATCH /api/preferences
            DELETE /api/account                     [no UI, no password check]
ACCOUNTS    GET|POST /api/accounts                  [POST no UI]
            PATCH|DELETE /api/accounts/[id]         [no UI]
TX          GET|POST /api/transactions
            GET|PATCH|DELETE /api/transactions/[id]
            POST /api/transactions/[id]/duplicate   [no UI]
            POST /api/transactions/import           [no UI]
INCOME      GET|POST /api/income                    (forces type=INCOME)
CATEGORIES  GET|POST /api/categories                [no UI]
            PATCH|DELETE /api/categories/[id]       [no UI]
BUDGETS     GET|POST /api/budgets
            PATCH|DELETE /api/budgets/[id]
GOALS       GET|POST /api/goals
            PATCH|DELETE /api/goals/[id]
RECURRING   GET|POST /api/recurring                 [no UI]
            PATCH|DELETE /api/recurring/[id]        [no UI]
NOTIF       GET|PATCH /api/notifications
            POST /api/notifications/read-all        [duplicate of PATCH]
            DELETE /api/notifications/[id]          [UI misuses as "mark read"]
DASHBOARD   GET /api/dashboard                      [GET has side effects]
ANALYTICS   GET /api/analytics/summary|categories|trends
EXPORT      GET /api/export?type=transactions|budgets   [budgets no UI]
AI          POST /api/ai/chat                       (20/min/user)
            GET /api/ai/insights                    [no UI]
            POST /api/ai/analyze                    [no UI, deterministic]
            GET|POST /api/ai/reports
            GET|DELETE /api/ai/reports/[id]         [GET no UI]
```

## B8 · Response contract

```jsonc
// 200 / 201
{ "success": true, "data": <T>, "message": "<verb phrase>" }
// error
{ "success": false,
  "error": { "code": "SNAKE_CASE", "message": "<human>", "details": [{"path":[],"message":""}]? } }
```
Codes observed: `VALIDATION_ERROR`(400) · `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` ·
`CONFLICT` · `TOO_MANY_REQUESTS` · `INTERNAL`(500) · `INVALID_CREDENTIALS`(401) ·
`WRONG_PASSWORD`(400) · `INVALID_TYPE`(400).

## B9 · Data model

```prisma
enums: TransactionType {EXPENSE INCOME TRANSFER}
       BudgetPeriod    {WEEKLY MONTHLY YEARLY CUSTOM}
       RecurrenceFrequency {DAILY WEEKLY MONTHLY YEARLY}
       AccountType {CASH BANK SAVINGS CREDIT_CARD WALLET INVESTMENT}
       CategoryType {EXPENSE INCOME BOTH}
       NotificationType {BUDGET_THRESHOLD BUDGET_EXCEEDED GOAL_DEADLINE
                         UNUSUAL_TRANSACTION RECURRING_UPCOMING AI_RECOMMENDATION
                         REPORT_GENERATED}
       MessageRole {USER ASSISTANT SYSTEM TOOL}
       ReportType {MONTHLY QUARTERLY YEARLY SPENDING_ANALYSIS BUDGET SAVINGS FINANCIAL_HEALTH}

models (14):
 User(id cuid, email @unique, passwordHash, name, avatarUrl?, onboardedAt?, timestamps)
 Profile(id, userId @unique→User Cascade, monthlyIncome? Decimal(14,2), occupation?, timezone="Asia/Kolkata")
 UserPreference(id, userId @unique→User Cascade, currency="INR", dateFormat="DD MMM YYYY",
                theme="system", notifyBudget/Goal/AIInsight/Recurring Boolean=true)
 Account(id, userId→User Cascade, name, type AccountType, balance Decimal(14,2)=0,
         currency="INR", timestamps)
 Category(id, name, icon?, color? hex, type=BOTH, isSystem=false, userId?→User Cascade, timestamps)
   @@unique([name, isSystem])   ⚠ GLOBAL, not per-user
 Transaction(id, userId→User Cascade, accountId?→Account SetNull, categoryId?→Category SetNull,
             type, amount Decimal(14,2), description?, merchant?, transactionDate,
             paymentMethod?, notes?, location?, tags String[]=[],
             isRecurring=false, recurringTransactionId?→RecurringTransaction SetNull, timestamps)
 Budget(id, userId→User Cascade, name, amount Decimal(14,2), period, startDate, endDate?,
        categoryId?→Category SetNull, timestamps)     // NO relation to Transaction
 SavingsGoal(id, userId→User Cascade, name, targetAmount, currentAmount=0, deadline?,
             category? String /*free text*/, description?, timestamps)
 RecurringTransaction(id, userId→User Cascade, accountId?→Account SetNull,
        categoryId?→Category SetNull, type, amount, description?, merchant?, frequency,
        nextExecutionDate, endDate?, active=true, autoCreate=true, lastExecutedAt?, timestamps)
 Notification(id, userId→User Cascade, title, message, type, read=false, link?, metadata? Json,
             createdAt)   // dedupe lives at metadata.dedupeKey, no column
 AIConversation(id, userId→User Cascade, title="New conversation", timestamps) → messages[]
 AIMessage(id, conversationId→AIConversation Cascade, role, content, toolName?, metadata? Json, createdAt)
 AIReport(id, userId→User Cascade, type, startDate, endDate, title, summary, content Json,
          healthScore? Int, metadata? Json, createdAt)
 AuditLog(id, userId?→User SetNull, action, entity /*required*/, entityId?, metadata? Json, createdAt)
```

Money: `Decimal @db.Decimal(14,2)` throughout. IDs: `cuid()`.

## B10 · Seed data

- Destructive: `deleteMany()` on **all** models including `user`.
- Demo user `demo@expensemanager.in` / password **`Demo@123`**
  (an unused `PASSWORD = "Demo@1234"` const also exists).
- 4 accounts, ~6 months of transactions, 4 budgets, 5 goals, 4 recurring, 6 notifications,
  1 AIConversation.
- System categories are written with `type: "EXPENSE"` even for income names, and
  `icon`/`color` null — diverging from `lib/constants`.
- Seeded goals have `category` but no `description`.

## B11 · Auth specification

```
cookie: em_session · httpOnly · sameSite=lax · path=/ · maxAge=30d · secure=(NODE_ENV=production)
jwt:    HS256 · payload {sub:userId} · iat · exp(30d) · secret = AUTH_SECRET ?? <HARDCODED DEV STRING>
password: bcrypt cost 10; policy 8..128 chars, ≥1 letter, ≥1 digit
login:   15/min per x-forwarded-for ?? "local" ; 401 INVALID_CREDENTIALS (same msg for both cases)
register:10/min per x-forwarded-for ?? "local" ; 409 on duplicate email
logout:  cookies().delete("em_session")
pages:   middleware.ts (11 prefixes)
api:     requireUserId() inside every handler   ← middleware does NOT cover /api
```

## B12 · Validation specification

Shared schemas in `lib/validation/schemas.ts` (21 exports). **Inline schemas also exist in**
`app/api/budgets/[id]/route.ts` (`budgetUpdateSchema`), `app/api/goals/[id]/route.ts`
(`goalUpdateSchema`), `app/api/analytics/trends/route.ts` (`monthsSchema`).

Recipes:
```ts
money           = z.coerce.number().positive().max(1e12)
isoDate         = z.coerce.date()
optionalTrimmed = (max) => z.string().trim().max(max).optional()
                            .or(z.literal("").transform(() => undefined))   // ❌ rejects null
cuidField       = z.string().cuid().optional().or(z.literal(null))         // ✅ accepts null
```

**Null-handling matrix (the source of B3/B5/B6):**

| Field | accepts `null`? |
|---|---|
| `transactionBase.categoryId` / `accountId` | ✅ |
| `budgetCreateSchema.categoryId` | ✅ |
| `budgetUpdateSchema.categoryId` (inline, budgets/[id]) | ❌ |
| `goalCreateSchema.deadline` | ✅ but `z.coerce.date()` turns `null` → **1970-01-01** |
| `goalCreateSchema.category`/`description` | ❌ |
| `goalUpdateSchema.deadline` (inline, goals/[id]) | ❌ → **1970-01-01** |
| `goalUpdateSchema.category`/`description` (inline) | ❌ |
| `recurringCreateSchema.categoryId`/`accountId`/`endDate` | ✅ |

Query validation exists **only** for `/api/transactions` (`transactionQuerySchema`) and
`/api/analytics/*` (`analyticsRangeSchema`, `monthsSchema`).

## B13 · Rate limiting

| Key | Limit | Window | Route |
|---|---:|---:|---|
| `login:<ip>` | 15 | 60s | POST /api/auth/login |
| `register:<ip>` | 10 | 60s | POST /api/auth/register |
| `ai:chat:<userId>` | 20 | 60s | POST /api/ai/chat |

In-memory `Map`, sliding window, evicts when size > 10_000 and bucket expired.

## B14 · Analytics specification

| Function | Formula / rule |
|---|---|
| savingsRate | `income>0 ? round2((income-expense)/income*100) : 0` |
| budget utilisation | `percentageOf(amount, spent)` where spent = EXPENSE in `[startDate, endDate??today]` scoped to `categoryId` if set |
| crossedThreshold | 100 / 90 / 75 / 50 (first match), else null |
| goal progressPct | `min(100, round2(current/target*100))` |
| goal overdue | `daysRemaining < 0 && remaining > 0` |
| requiredMonthlySaving | `round2(remaining / max(1, ceil(daysRemaining/30)))` |
| anomaly | needs ≥5 samples in prior 90d, `amount ≥ 500`; fires if `amount/avg ≥ 3` **or** z ≥ 3 |
| forecast projection | `dayOfMonth>2 ? current/dayOfMonth*daysInMonth : avgLast4` |
| affordability | `can_afford` if `balance≥amount && pct≤100`; `potentially_risky` if `balance+disposable≥amount && pct≤200`; else `not_recommended` |
| health score | SavingsRate 30 (`rate/30*100`) · BudgetAdherence 20 (`%≤100`, default 70) · ExpenseGrowth 15 (`100+(prev-cur)/prev*100`, default 60) · RecurringLoad 10 (`100-%*2`) · GoalProgress 15 (mean, default 50) · EmergencyFund 10 (`balance/(3*avgExpense)*100`, default 50) → round+clamp 0..100 |
| health grade | ≥80 Excellent · ≥65 Good · ≥45 Fair · else Needs attention |
| range presets | this_week(Mon-start), this_month, last_month, 3_months, 6_months, this_year, custom |

## B15 · Notification specification

Producers (exactly 4 call sites):

| Trigger | Types | dedupe key |
|---|---|---|
| after expense created | `BUDGET_THRESHOLD`/`BUDGET_EXCEEDED` | `<budgetId>:<YYYY-MM-DD>:<threshold>` |
| after expense created | `UNUSUAL_TRANSACTION` | `anomaly:<txId>` |
| dashboard housekeeping | `GOAL_DEADLINE` (14-day window) | `goal:<id>:<YYYY-MM-DD>` |
| report generated | `REPORT_GENERATED` | **none** |

Dedupe implementation: lookup `metadata: {path:["dedupeKey"], equals:key}` restricted to
`read: false` → **keys re-fire after being read**.
Preference flags `notify*` are **never read** by any producer.

## B16 · Recurring engine specification

```
select: active && autoCreate && nextExecutionDate<=now && (endDate null or >=now), take 200
per row (prisma.$transaction):
  while cursor<=now && guard<24: create Transaction(isRecurring=true, recurringTransactionId)
                                 cursor = advance(+1d | +7d | month+1 | year+1); guard++
  set nextExecutionDate=cursor, lastExecutedAt=now
  if accountId && type!=TRANSFER: balance += ±amount*max(1,guard)
idempotent because cursor lands strictly after `now`
triggered ONLY by GET /api/dashboard   ← there is NO scheduler
```

## B17 · AI specification

```
POST /api/ai/chat {message 1..2000, conversationId? cuid}   rate 20/min/user
  → agents/agent-runner.runAgentChat({userId, message, conversationId})
     pipeline: intent → planner → tools → analysis → decision → report
     provider: OpenAI-compatible over AI_BASE_URL with AI_MODEL + AI_API_KEY
     output: single JSON (no streaming)
governing rule: model narrates, never computes
⚠ app/(app)/ai/page.tsx never sends conversationId → new conversation per message
```

## B18 · Design tokens

```css
:root{ --background:0 0% 100%; --foreground:222.2 84% 4.9%;
       --primary:142 76% 36%;  --primary-foreground:355.7 100% 97.3%;
       --success:142 76% 36%;  --warning:38 92% 50%;  --radius:0.75rem; … }
.dark{ --background:222.2 84% 4.9%; --primary:142 76% 40%; … }
```
Tailwind: `darkMode:"class"`, container centered (2xl 1280px, 1.5rem padding), Inter,
radius scale from `--radius`, animations `fade-in | slide-up | shimmer | pulse-soft`.
Button variants: `default|destructive|outline|secondary|ghost|link`; sizes `default|sm|lg|icon`.
`components/ui/select.tsx` is a **native `<select>` wrapper**, not Radix Select.

## B19 · Test inventory (67 passing)

| File | # | Covers |
|---|---:|---|
| `tests/money.test.ts` | 17 | round2, safeDivide, percentChange, percentageOf, mean, stdDeviation, sum, clamp |
| `tests/intent.test.ts` | 20 | AI intent classification |
| `tests/validation.test.ts` | 19 | zod schemas (with cuid-shaped fixtures — why UI names aren't caught) |
| `tests/goal.test.ts` | 6 | mapGoal progress/overdue/required saving |
| `tests/budget.test.ts` | 5 | crossedThreshold |

No API integration tests. No UI/E2E tests. No coverage thresholds. No CI.

## B20 · Quality gates (measured 2026-09-27)

```json
{ "typecheck": "PASS (0 errors)",
  "lint": "PASS (0 errors, 1 warning: components/ui/avatar.tsx:74 no-img-element)",
  "tests": "PASS (5 files, 67 tests, 611ms)",
  "db": "UNREACHABLE (localhost:5432 refused)",
  "production_build": "NOT BUILT (missing .next/BUILD_ID)",
  "npm_audit_prod": "2 vulns (1 critical, 1 high)",
  "migrations_dir": "ABSENT" }
```

## B21 · Issue register (summary — detail in `KNOWN_ISSUES.md`)

```yaml
critical:
  - B1: transactions page sends category NAME as categoryId -> 400 on add/edit
  - B2: income page sends category NAME as categoryId -> 400 on add
  - B3: budget PATCH inline schema rejects null categoryId -> edit always 400
high:
  - B4: budget create fails when a category is chosen
  - B5: goal create fails unless category AND description non-null
  - B6: goal PATCH: null deadline -> 1970-01-01; null category/description -> 400
  - B7: notification "mark as read" calls DELETE (destroys row)
medium:
  - B8: transaction category filter silently ignored (400 swallowed)
  - B9: AI chat never sends conversationId
  - B10: budget openEdit resets categoryId to ""
  - B11: no Accounts UI -> Total Balance always 0 for new users
  - B12: TRANSFER moves no money
low:
  - B13..B20 (settings delete stub, fake landing stats, inert prefs,
    duplicate read-all route, unvalidated pagination, global category unique,
    seed wipes all tenants, dead code)
structural:
  - S1 dual source of truth for categories (constants vs DB)
  - S2 dual source of truth for validation (lib vs inline route schemas)
  - S3 no integration tests
  - S4 silent client error handling
  - S5 no scheduler; S6 GET with side effects
security:
  - F1 hardcoded AUTH_SECRET fallback (HIGH)
  - F2 30-day non-revocable JWT (HIGH)
  - F3 next@14.2.35 advisories (HIGH/CRITICAL)
  - F4 spoofable rate-limit IP (MEDIUM)
  - F5 in-memory rate limiter (MEDIUM)
  - F6 DELETE /api/account without password (MEDIUM)
  - F7 /api not covered by middleware (MEDIUM)
  - F8 no security headers (MEDIUM)
  - F9 seed wipes all tenants (MEDIUM)
  - F10 global Category unique (MEDIUM)
  - F11..F16 low-severity hygiene
```

## B22 · First actions for a new agent

1. Read `KNOWN_ISSUES.md` — do not re-derive the bugs.
2. Start PostgreSQL; `prisma db push`; `db:seed` (⚠ destructive); `npm run dev`.
3. Add **one integration test harness** before touching payloads (Roadmap 5.1–5.3).
4. Fix Phase 1 (`docs/ROADMAP.md`): resolve the category contract decision first (Option A
   recommended — see Roadmap 1.1); B1–B8 all fall out of it.
5. Keep `typecheck` / `lint` / `test` green after every change.
6. Run `npm audit` after any dependency change.

---

*Companion documents: `PROJECT_INTELLIGENCE.md` (43-section analysis) · `PROJECT_OVERVIEW.md` ·
`ARCHITECTURE.md` · `FEATURES.md` · `WORKFLOWS.md` · `DATABASE.md` · `API.md` ·
`BUSINESS_LOGIC.md` · `SECURITY.md` · `KNOWN_ISSUES.md` · `ROADMAP.md`.*
