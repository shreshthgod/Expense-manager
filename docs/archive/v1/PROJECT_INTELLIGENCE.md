# PROJECT INTELLIGENCE DOCUMENT

**Project:** `expense-manager` · **Version:** 1.0.0 · **Location:** `/home/makan/A-015`
**Method:** read-only reverse engineering of source, config, tests, and empirical zod/TS/vitest execution.
**Evidence markers:** `CONFIRMED` (verified by direct code read or executed test), `INFERRED` (strongly implied, not executed), `UNKNOWN` (insufficient evidence).

> No source files, packages, or config were modified during this analysis.

---

## 1. Document Purpose & How to Read

This document is a complete intelligence report on the existing codebase. It is written for
(a) humans who need to understand or inherit the project, and
(b) future AI agents that must extend it without breaking it.

- Sections 1–25 = *what the system is and how it is wired.*
- Sections 26–35 = *what the system computes (business + analytics + AI).*
- Sections 36–40 = *how the UI, testing, and delivery work.*
- Sections 41–43 = *what is wrong, risky, or incomplete.*

For the condensed machine-readable brief see `docs/AI_PROJECT_CONTEXT.md`.
For the prioritized fix list see `docs/ROADMAP.md`.

---

## 2. Project Identity

| Field | Value | Confidence |
|---|---|---|
| npm name | `expense-manager` | CONFIRMED (`package.json`) |
| version | `1.0.0` | CONFIRMED |
| description | "AI-powered personal finance platform" | CONFIRMED (`package.json`) |
| license | *(absent)* | CONFIRMED |
| repository / author | *(absent)* | CONFIRMED |
| private | `true` | CONFIRMED |
| Package manager | npm (lockfile v3 present: `package-lock.json`) | CONFIRMED |
| Git repository | **No** — `/home/makan/A-015` is not a git repo | CONFIRMED (`ls -a`, env) |
| Primary currency | INR (₹), locale `en-IN` | CONFIRMED (`lib/utils/format.ts`) |
| Target market | India (UPI, Net Banking, ₹ lakh/crore formatting) | INFERRED (`formatCompactCurrency`, `PAYMENT_METHODS`) |

---

## 3. Product Summary & Vision

**One-line:** A self-hosted, single-tenant-per-row web app where a user records income/expenses,
sets budgets and savings goals, and gets deterministic financial analytics plus an AI chat agent
that *explains* the numbers rather than inventing them.

**Vision signals (CONFIRMED):**
- Tagline: *"Understand your money. Control your future."* (`lib/constants/index.ts:103`)
- Explicit architectural principle stated in code comments: *"Deterministic financial health score
  (0-100). Every component is computed from real data — the AI may only explain the result, never
  invent it."* (`server/analytics/health-score.ts:12-18`)
- Same principle repeated in `forecast.ts` and `affordability.ts`.

**Positioning:** Personal finance manager with an "agent" layer (intent → planner → tools →
analysis → decision → report) sitting on top of a conventional CRUD finance core.

---

## 4. Target User & Core Personas

| Persona | Evidence | Confidence |
|---|---|---|
| Individual salaried/freelance earner in India | `INCOME_CATEGORIES` (Salary/Freelance/Business), UPI payment methods, ₹ formatting | INFERRED |
| Household budget keeper | Budget periods MONTHLY/WEEKLY/YEARLY/CUSTOM, category budgets | INFERRED |
| Financial self-improver | Savings goals, health score, AI chat, reports | INFERRED |
| Demo / evaluator | `prisma/seed.ts` creates `demo@expensemanager.in` with 6 months of synthetic data | CONFIRMED |

No multi-tenant org/team model, no shared households, no bank aggregation — **single user only.**

---

## 5. Feature Scope (In / Out)

### In scope (CONFIRMED implemented)
- Email/password auth (register, login, logout), JWT session cookie
- 5-step onboarding (income, categories, budget, goal)
- Transaction CRUD + search/filter/pagination/sort + CSV export
- Income sub-list (income-typed transactions)
- Accounts CRUD (API), running balances
- Categories CRUD (API), seeded system categories
- Budgets CRUD + live utilization + threshold notifications
- Savings goals CRUD + contributions + deadline notifications
- Recurring transactions CRUD + idempotent materialization
- Notifications (bell, page, mark-read, read-all)
- Analytics: summary, category breakdown, monthly trend, budget status, anomaly detection,
  forecast, affordability, financial health score
- AI chat, AI "insights", AI transaction analysis, generated reports (Monthly/Quarterly/Yearly)
- Settings: profile, preferences, change password, delete account (API)
- Dark/light/system theming

### Out of scope / absent (CONFIRMED by absence)
- Bank/UPI/credit-card sync, OFX/QIF import, receipt OCR
- Multi-currency FX conversion (currency preference is stored but ignored)
- Sharing, household, multi-user roles
- Mobile apps / PWA / offline
- Email or push delivery of notifications (all in-app only)
- Password reset / email verification / MFA
- Localization (only `en-IN` hardcoded)
- Audit-log UI (`AuditLog` model + writes exist, no reader route)

---

## 6. Technology Stack

| Layer | Choice | Version (installed) | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | 14.2.35 | `runtime = "nodejs"` on all API routes |
| Language | TypeScript | 5.7.x | strict |
| UI | React | 18.3.1 | Server + client components |
| Styling | Tailwind CSS | 3.4.17 | CSS-variable design tokens |
| Components | shadcn-style custom primitives + Radix Slot/Label | — | CVA for button variants |
| Icons | lucide-react | 0.468.0 | |
| Animation | framer-motion | 11.18.2 | |
| Charts | Recharts | 2.15.4 | |
| Theme | next-themes | 0.4.6 | `darkMode: "class"` |
| ORM | Prisma | 5.22.0 | PostgreSQL |
| DB | PostgreSQL | — | **driver not declared in package.json** (see §24) |
| Auth crypto | `jose` (HS256 JWT) + `bcryptjs` | 5.10.0 / 2.4.3 | |
| Validation | zod | 3.25.76 | |
| Tests | Vitest | 2.1.9 | |
| Lint | ESLint 8 + `eslint-config-next` | 8.57.1 | |

**Notable:** `date-fns` is a declared dependency but **zero imports** exist anywhere — dead dependency (CONFIRMED via grep).

---

## 7. Runtime, Tooling & Scripts

`package.json` scripts (CONFIRMED):

| Script | Command | Purpose |
|---|---|---|
| `dev` | `next dev` | Dev server |
| `build` | `prisma generate && next build` | Production build (generates client first) |
| `start` | `next start` | Serve production build |
| `lint` | `next lint` | ESLint |
| `typecheck` | `tsc --noEmit` | Type gate |
| `test` | `vitest run` | Unit tests |
| `test:watch` | `vitest` | Watch mode |
| `db:migrate` | `prisma migrate dev` | Dev migration (**no `prisma/migrations/` dir exists**) |
| `db:push` | `prisma db push` | Schema push |
| `db:seed` | `tsx prisma/seed.ts` | Seed demo data |
| `db:studio` | `prisma studio` | DB GUI |

**Quality gates measured in this session (CONFIRMED):**
- `npx tsc --noEmit` → **exit 0, no errors**
- `npx next lint` → **exit 0**, 1 warning (`components/ui/avatar.tsx:74` `<img>` vs `next/image`)
- `npx vitest run` → **5 files, 67 tests, all passing**, 611 ms

---

## 8. Repository Layout

```
/home/makan/A-015
├── app/                    # Next.js App Router (53 ts/tsx files, 5,222 lines)
│   ├── api/                # 35 route.ts files, 55 HTTP handlers
│   ├── (app)/              # authenticated pages + Shell
│   ├── (auth)/             # login, register (centered card layout)
│   ├── (marketing)/        # layout.tsx ONLY → no pages (dead group)
│   ├── onboarding/         # standalone full-screen wizard (outside route groups)
│   ├── layout.tsx          # root: ThemeProvider + ToastProvider
│   ├── page.tsx            # marketing landing "/" (root, not in any group)
│   └── globals.css         # design tokens (light + dark)
├── components/             # 20 files, 1,496 lines (shell.tsx + ui/)
├── lib/                    # 13 files, 706 lines (auth, api, validation, utils, constants, db)
├── server/                 # 25 files, 2,445 lines (services/ + analytics/)
├── agents/                 # 9 files, 1,331 lines (AI pipeline)
├── prisma/                 # schema.prisma + seed.ts (519 lines)
├── tests/                  # 5 files, 565 lines
├── types/                  # api.ts, index.ts (161 lines)
├── middleware.ts           # route protection
├── tailwind.config.ts      # theme extension + animations
├── next.config.mjs         # reactStrictMode, poweredByHeader:false
└── vitest.config.ts
```

Total first-party TS/TSX ≈ **11,945 lines** across 131 files (CONFIRMED by `wc -l` aggregation).

---

## 9. Code Inventory

| Area | Files | Lines | Share |
|---|---:|---:|---:|
| `app/` (pages + API) | 53 | 5,222 | 43.7% |
| `server/` (business + analytics) | 25 | 2,445 | 20.5% |
| `agents/` (AI) | 9 | 1,331 | 11.1% |
| `components/` | 20 | 1,496 | 12.5% |
| `prisma/` | 1 | 519 | 4.3% |
| `tests/` | 5 | 565 | 4.7% |
| `lib/` | 13 | 706 | 5.9% |
| `types/` | 2 | 161 | 1.3% |

*(Percentages are of the measured total; `middleware.ts` and configs excluded.)*

**Architecture ratio:** ~37% of non-test code is infrastructure (app/lib), ~31% is domain logic
(server + agents). The domain layer is genuinely separated from HTTP — services never touch
`Request`/`Response` (CONFIRMED by reading `server/**`).

---

## 10. Page Routing Map

14 `page.tsx` files (CONFIRMED):

| Route | File | Auth | Group |
|---|---|---|---|
| `/` | `app/page.tsx` | public | — (marketing, hardcoded demo) |
| `/login` | `app/(auth)/login/page.tsx` | public (redirect if session) | `(auth)` |
| `/register` | `app/(auth)/register/page.tsx` | public (redirect if session) | `(auth)` |
| `/onboarding` | `app/onboarding/page.tsx` | protected | none |
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

**Missing pages (CONFIRMED absence):** `/accounts`, `/categories`, `/recurring`, `/audit`.
Those subsystems have full APIs but **zero UI** (see §43).

`app/(marketing)/layout.tsx` exists but contains no `page.tsx` → **dead route group** (CONFIRMED).

---

## 11. Layout Hierarchy & Shell

```
app/layout.tsx  (root: <html>, ThemeProvider, ToastProvider, global CSS)
├── app/page.tsx                     → no Shell (full-bleed landing)
├── (auth)/layout.tsx                → centered max-w-md card, no Shell
├── onboarding/page.tsx              → no Shell (own stepper chrome)
└── (app)/layout.tsx                 → getCurrentUser() || redirect("/login")
    └── <Shell user={user}>          → components/shell.tsx
        ├── sidebar nav (10 items)
        ├── topbar: search-less, notification bell, theme toggle, avatar dropdown
        └── <main>{children}</main>
```

- `getCurrentUser` is wrapped in React `cache()` → one DB round-trip per request (CONFIRMED `lib/auth/session.ts`).
- `Shell` is a client component receiving a serialized `user` prop — no client-side auth fetch (CONFIRMED `app/(app)/layout.tsx`).

---

## 12. Middleware & Route Protection

`middleware.ts` (CONFIRMED):

- `PROTECTED_PREFIXES` (11): `/dashboard`, `/transactions`, `/income`, `/budgets`, `/goals`,
  `/analytics`, `/ai`, `/reports`, `/notifications`, `/settings`, `/onboarding`
- `AUTH_PAGES` (2): `/login`, `/register` → redirected to `/dashboard` when a valid session exists
- Unauthenticated protected hit → `/login?next=<pathname>` (but **login page never consumes `next`** — see §43)
- Matcher excludes `api`, `_next/static`, `_next/image`, `favicon.ico`, and static asset extensions.

**Implication:** `/` (landing) is public. **API routes are NOT covered by middleware** — every
handler must call `requireUserId()` itself. All 55 handlers do (CONFIRMED by grep), but this is a
maintainability hazard: one forgotten call = unauthenticated endpoint.

---

## 13. Authentication Flow

**Register** (`app/api/auth/register/route.ts`):
1. Rate-limit `register:<ip>` 10/min → zod `registerSchema`
2. Name 2–80 chars; email normalized lowercase; password ≥8, ≤128, must contain a letter **and** a digit
3. Duplicate email → 409 `CONFLICT`
4. `bcrypt.hash(pw, 10)` (`lib/auth/password.ts`)
5. `prisma.user.create` with nested `preference: {create:{}}` and `profile: {create:{}}`
6. Audit `REGISTER` → set session cookie → return `{id,name,email,onboardedAt}`

**Login** (`app/api/auth/login/route.ts`):
1. Rate-limit `login:<ip>` 15/min → zod `loginSchema`
2. Lookup by email; `bcrypt.compare` (constant-time-ish via bcryptjs)
3. Failure → **401 `INVALID_CREDENTIALS` with identical message whether user missing or bad password** (user enumeration resistance — CONFIRMED)
4. Audit `LOGIN` → set cookie

**Logout:** `POST /api/auth/logout` → `cookies().delete(SESSION_COOKIE_NAME)` (CONFIRMED `lib/auth/session.ts`).

**Client pages:** login/register call `POST /api/auth/*`, then `router.replace(next || "/dashboard")`
— `next` is read from the query string client-side; middleware *does* set `?next=` (CONFIRMED both sides).
Earlier suspicion that `next` was dropped is **not** supported for the login page.

---

## 14. Session & Token Management

`lib/auth/jwt.ts` (CONFIRMED):

- HS256 via `jose`, payload `{ sub: userId }`, `iat`, `exp`
- TTL = 60 × 60 × 24 × 30 = **30 days**, constant `SESSION_DURATION_SECONDS`
- Cookie `em_session`: `httpOnly`, `sameSite: "lax"`, `path: "/"`, `maxAge` 30d,
  `secure: NODE_ENV === "production"`
- **No refresh rotation, no token revocation list, no `jti`.** A leaked token is valid for 30 days
  even after password change or account deletion (CONFIRMED — no invalidation code path exists).

> **Risk:** `getSecretKey()` falls back to the literal string
> `"dev-only-secret-change-me-in-production-0123456789abcdef"` when `AUTH_SECRET` is unset.
> Anyone can forge `sub` claims in that state. See §41.

---

## 15. Authorization & Tenant Isolation

**Pattern (CONFIRMED consistent across all services):** every query filters by `userId`.

| Mechanism | Evidence |
|---|---|
| `requireUserId()` in every API handler | `lib/api/auth.ts`, grep across `app/api/**` |
| `findFirst({ where: { id, userId } })` before update/delete | `transaction.service.ts`, `budget.service.ts`, `goal.service.ts`, `category.service.ts`, `account.service.ts`, `recurring.service.ts` |
| `deleteMany({ where: { id, userId } })` + `count === 0 → 404` | `recurring.service.ts`, `budget.service.ts`, `goal.service.ts` |
| `updateMany` with `userId` for notifications | `notification.service.ts` |

**No role model, no ownership escalation surface found.** Object IDs are Prisma `cuid()`s
(unpredictable) and are still always paired with a `userId` predicate — defence in depth (CONFIRMED).

**Gap:** `AuditLog` rows are written but there is no reader endpoint → users cannot audit their own
access (UNKNOWN whether intentional).

---

## 16. API Conventions & Response Contract

All handlers are `export async function METHOD(request: Request)` with `export const runtime = "nodejs"`.

**Envelope** (`lib/api/response.ts`, CONFIRMED):

```jsonc
// success
{ "success": true,  "data": <T>, "meta": {...}?, "message": "..."? }
// failure
{ "success": false, "error": { "code": "SNAKE_CASE", "message": "human text", "details": [...]? } }
```

Convenience wrappers: `ok()`, `created()`, `fail()`, `handleRoute()`, `readJson()`.
`handleRoute()` catches `ZodError` → 400 `VALIDATION_ERROR` with field `details`;
catches `ApiError` → its status/code; anything else → 500 `INTERNAL` (and logs).

`ApiError` factory methods (`lib/api/errors.ts`): `badRequest`, `unauthorized`, `forbidden`,
`notFound`, `conflict`, `tooManyRequests`, `internal`.

**Method semantics:** `GET` list/detail, `POST` create, `PATCH` partial update, `PUT` = full
profile/password replace (only `app/api/profile/route.ts`), `DELETE` remove. No `PUT` elsewhere.

**Content types:** JSON in/out except `GET /api/export` which returns `text/csv`
with `Content-Disposition: attachment`.

---

## 17. API Endpoint Inventory

55 handlers across 35 route files (CONFIRMED by source enumeration):

### Auth
| Method | Path | Handler file |
|---|---|---|
| POST | `/api/auth/register` | `app/api/auth/register/route.ts` |
| POST | `/api/auth/login` | `app/api/auth/login/route.ts` |
| POST | `/api/auth/logout` | `app/api/auth/logout/route.ts` |

### User / onboarding / preferences
| Method | Path | Notes |
|---|---|---|
| POST | `/api/onboarding` | sets `onboardedAt`; may create profile, categories, account, budget, goal |
| GET/PATCH | `/api/profile` | |
| PUT | `/api/profile` | |
| GET/PATCH | `/api/preferences` | |
| DELETE | `/api/account` | **delete whole account** — UI never calls it |

### Transactions & income
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/transactions` | 14 query params, zod-validated |
| GET/PATCH/DELETE | `/api/transactions/[id]` | |
| POST | `/api/transactions/[id]/duplicate` | **no UI caller** |
| POST | `/api/transactions/import` | CSV confirm — **no UI caller** |

### Accounts / categories
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/accounts` | **no UI page**; only read by transaction forms |
| PATCH/DELETE | `/api/accounts/[id]` | **no UI caller** |
| GET/POST | `/api/categories` | **no UI caller** |
| PATCH/DELETE | `/api/categories/[id]` | **no UI caller** |

### Budgets / goals / recurring
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/budgets` | |
| PATCH/DELETE | `/api/budgets/[id]` | PATCH always fails from UI (§43) |
| GET/POST | `/api/goals` | POST fails from UI (§43) |
| PATCH/DELETE | `/api/goals/[id]` | PATCH fails when `category`/`description` null |
| GET/POST | `/api/recurring` | **no UI at all** |
| PATCH/DELETE | `/api/recurring/[id]` | **no UI at all** |

### Notifications
| Method | Path | Notes |
|---|---|---|
| GET | `/api/notifications?page=&pageSize=` | `page/pageSize` are **not** zod-validated |
| PATCH | `/api/notifications` | mark-all-read — **no UI caller** |
| POST | `/api/notifications/read-all` | identical behaviour — **this is the one the UI calls** |
| DELETE | `/api/notifications/[id]` | **UI uses this for "mark as read" → deletes** (§43) |

### Dashboard / analytics / export
| Method | Path |
|---|---|
| GET | `/api/dashboard` |
| GET | `/api/analytics/summary?preset=&startDate=&endDate=` |
| GET | `/api/analytics/categories?preset=` |
| GET | `/api/analytics/trends?months=` |
| GET | `/api/export?type=transactions|budgets` |

### AI
| Method | Path | UI caller |
|---|---|---|
| POST | `/api/ai/chat` | `/ai` page (never sends `conversationId`) |
| GET | `/api/ai/insights` | **none** |
| POST | `/api/ai/analyze` | **none** |
| GET | `/api/ai/reports` | `/reports` |
| POST | `/api/ai/reports` | `/reports` |
| GET | `/api/ai/reports/[id]` | **none** |
| DELETE | `/api/ai/reports/[id]` | `/reports` |

---

## 18. Request Validation Layer

`lib/validation/schemas.ts` (242 lines, CONFIRMED). 23 exported schemas.

**Primitive recipes:**
- `money` = `z.coerce.number().positive().max(1e12)`
- `isoDate` = `z.coerce.date()` (accepts string/Date/number)
- `optionalTrimmed(max)` = `z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined))`
- `cuid` fields: `z.string().cuid()` for all relational IDs

**Critical asymmetry (root cause of most bugs, CONFIRMED by executed zod tests):**

| Schema | `null` accepted? |
|---|---|
| `transactionBase.categoryId` | ✅ `.or(z.literal(null))` |
| `budgetCreateSchema.categoryId` | ✅ `.or(z.literal(null))` |
| `budgetUpdateSchema.categoryId` (defined inline in route) | ❌ `z.string().cuid().optional()` only |
| `goalCreateSchema.deadline` | ✅ but **`z.coerce.date()` runs first and turns `null` into 1970-01-01** |
| `goalCreateSchema.category` / `.description` | ❌ `optionalTrimmed` rejects `null` |
| `recurringCreateSchema.categoryId/accountId/endDate` | ✅ `.or(z.literal(null))` |

Executed results (`node` + project's own `zod@3.25.76`):

```
goal CREATE nulls            => FAIL  category Invalid input
goal CREATE cat filled       => OK
goal UPDATE deadline null    => OK    {"deadline":"1970-01-01T00:00:00.000Z"}   ← silent data corruption
goal UPDATE category null    => FAIL  category Invalid input
budget CREATE categoryId=name=> FAIL  categoryId Invalid cuid
budget CREATE categoryId=null=> OK
TX   CREATE categoryId=name  => FAIL  categoryId Category is required
TX   QUERY  categoryId=name  => FAIL  categoryId Invalid cuid
```

**Query validation** lives in `transactionQuerySchema` (page/pageSize/search/type/categoryId/
accountId/merchant/minAmount/maxAmount/startDate/endDate/sortBy/sortDir) — enforced **only** on
transactions. Budgets/notifications query params are unvalidated (INFERRED: no schema exists).

---

## 19. Error Handling

- **Server:** single funnel `handleRoute()`; `ZodError → 400 VALIDATION_ERROR`; `ApiError → its own code`;
  unknown → 500 INTERNAL + `console.error` (CONFIRMED `lib/api/response.ts`).
- **Service layer:** throws `ApiError.notFound(...)` etc.; no try/catch inside services except
  *side-effect* blocks that intentionally swallow and log:
  - `afterExpenseCreated` (budget + anomaly notifications) — `console.error`, never fails the create
  - `checkGoalDeadlines` — same
  - `processDueRecurrences` — per-recurrence try/catch
  (CONFIRMED in respective files.)
- **Client:** every page follows `fetch → res.json() → if (!data.success) addToast(error.message)` then
  `catch { addToast("Something went wrong", "error") }`. **Network failures and HTTP status are never
  distinguished**; a 401 session expiry surfaces as a generic toast rather than a redirect (INFERRED,
  no 401 interceptor exists anywhere).
- **Not found:** `findX` returning `null` → `ApiError.notFound` → 404; but `deleteMany`-based deletes
  return `{deleted: false}`/`{deleted: 0}` with HTTP 200 in some routes (e.g. notifications DELETE
  returns `deleted: count` — CONFIRMED), so "delete of non-existent" is indistinguishable from success
  to a casual caller.

---

## 20. Rate Limiting & Abuse Controls

`lib/api/rate-limit.ts` — in-memory sliding window `Map<string, number[]>`.

| Key | Limit | Window | Route |
|---|---:|---:|---|
| `login:<ip>` | 15 | 60 s | `POST /api/auth/login` |
| `register:<ip>` | 10 | 60 s | `POST /api/auth/register` |
| `ai:chat:<userId>` | 20 | 60 s | `POST /api/ai/chat` |

- IP taken from `x-forwarded-for` header, `?? "local"` (CONFIRMED) → **spoofable when not behind a
  trusted proxy**; all requests collapse to key `local` if the header is absent, so N distinct clients
  would share one bucket in a direct-exposure deployment.
- Map eviction only when `size > 10_000` and a bucket is fully expired → **unbounded growth is
  possible under many distinct keys** before eviction (INFERRED).
- `enforceRateLimit` **throws before `handleRoute`'s parse in login/register?** No — it is called
  *inside* `handleRoute`, so 429 is correctly converted to a JSON envelope (CONFIRMED).
- No rate limits on: transactions, budgets, goals, export, reports, notifications, profile.
- No `Retry-After` header, no CAPTCHA, no lockout after repeated failures.

---

## 21. Data Model Overview (ERD)

`prisma/schema.prisma`, 14 models + 8 enums (CONFIRMED):

```
User ─1:1─ Profile            (Cascade)
User ─1:1─ UserPreference     (Cascade)
User ─1:n─ Account            (Cascade)
User ─1:n─ Category           (userId optional → system categories have userId = null)
User ─1:n─ Transaction        (Cascade)
User ─1:n─ Budget             (Cascade)
User ─1:n─ SavingsGoal        (Cascade)
User ─1:n─ RecurringTransaction (Cascade)
User ─1:n─ Notification       (Cascade)
User ─1:n─ AIConversation ─1:n─ AIMessage (Cascade)
User ─1:n─ AIReport           (Cascade)
User ─1:n─ AuditLog           (userId nullable → SetNull, audit rows survive the user)

Transaction ─0..1─ Account               (onDelete: SetNull)
Transaction ─0..1─ Category              (onDelete: SetNull)
Transaction ─0..1─ RecurringTransaction  (onDelete: SetNull)
Budget        ─0..1─ Category            (onDelete: SetNull)
RecurringTransaction ─0..1─ Account/Category (SetNull)
```

Money is stored as `Decimal @db.Decimal(14,2)`; dates as `DateTime`; IDs `String @id @default(cuid())`.
`Account.balance` is a *materialized* running total, mutated by transaction and recurring services.

---

## 22. Model Field Reference

**User** — `id, email @unique, name, passwordHash, avatarUrl?, onboardedAt?, createdAt, updatedAt`
(`@@index([email])`)
**UserPreference** — `id, userId @unique, currency = "INR", dateFormat = "DD MMM YYYY",
theme = "system", notifyBudget/notifyGoal/notifyAIInsight/notifyRecurring (Bool, default true)`
**Profile** — `id, userId @unique, monthlyIncome? Decimal(14,2), occupation?,
timezone = "Asia/Kolkata"`
**Account** — `id, userId, name, type (AccountType), balance Decimal(14,2) = 0, currency = "INR",
createdAt, updatedAt` → `transactions[]`, `recurringTransactions[]`
**Category** — `id, name, icon?, color?, type (CategoryType) = BOTH, isSystem = false, userId?,
createdAt, updatedAt` → `transactions[]`, `budgets[]`, `recurringTransactions[]`
  - `userId` is **nullable** ⇒ system categories are global shared rows (`isSystem = true`),
    while user-created ones carry a `userId`. *(INFERRED from `onboarding` writing `userId` +
    `isSystem:false` and the seed writing global rows.)*
  - ⚠ **`@@unique([name, isSystem])` is global, not per-user** ⇒ two different tenants cannot both
    create a custom category named "Food" (`isSystem = false`). Cross-tenant uniqueness leak (CONFIRMED
    from schema; exploitability INFERRED — the UI currently can't create categories at all).
**Transaction** — `id, userId, accountId?, categoryId?, type (TransactionType), amount
Decimal(14,2), description?, merchant?, transactionDate, paymentMethod?, notes?, location?,
tags String[] = [], isRecurring = false, recurringTransactionId?, createdAt, updatedAt`
→ relations: `user` (Cascade), `account` (SetNull), `category` (SetNull),
`recurringTransaction` (SetNull)
**Budget** — `id, userId, name, amount Decimal(14,2), period (BudgetPeriod), startDate, endDate?,
categoryId?, createdAt, updatedAt` → relations: `user` (Cascade), `category` (SetNull).
**There is no `Budget → Transaction` relation** — spending is matched by query predicate only (§28).
**SavingsGoal** — `id, userId, name, targetAmount Decimal(14,2), currentAmount Decimal(14,2) = 0,
deadline?, category? (**free-text String, not a relation**), description?, createdAt, updatedAt`
**RecurringTransaction** — `id, userId, accountId?, categoryId?, type (EXPENSE|INCOME), amount,
description?, merchant?, frequency (DAILY|WEEKLY|MONTHLY|YEARLY), nextExecutionDate, endDate?,
active = true, autoCreate = true, lastExecutedAt?, createdAt, updatedAt`
**Notification** — `id, userId, title, message, type (NotificationType), read = false, link?,
metadata? (Json), createdAt`. **No `dedupeKey` column** — dedupe is implemented by storing the key
at `metadata.dedupeKey` and querying with `metadata: { path: ["dedupeKey"], equals: … }`
(C — `server/services/notification.service.ts`). The guard only matches **unread** rows, so a key
re-fires after the notification is read.
**AIConversation** — `id, userId, title = "New conversation", createdAt, updatedAt` → `messages[]`
**AIMessage** — `id, conversationId, role (MessageRole), content, toolName?, metadata? (Json),
createdAt`
**AIReport** — `id, userId, type (ReportType), startDate, endDate, title, summary,
content (Json), healthScore? Int, metadata? (Json), createdAt` — *no* `year`/`month`/`quarter`/
`status` columns; the period lives inside `content.period`.
**AuditLog** — `id, userId? (**nullable**, SetNull), action, entity (required), entityId?,
metadata? (Json), createdAt` — **no `ip` column**. Actions are a fixed union in
`server/services/audit.service.ts`: `REGISTER, LOGIN, LOGOUT, CREATE_TRANSACTION,
UPDATE_TRANSACTION, DELETE_TRANSACTION, IMPORT_TRANSACTIONS, CREATE_BUDGET, UPDATE_BUDGET,
DELETE_BUDGET, CREATE_GOAL, UPDATE_GOAL, DELETE_GOAL, CREATE_ACCOUNT, DELETE_ACCOUNT,
AI_REPORT_GENERATED, PASSWORD_CHANGED, ACCOUNT_DELETED`.

---

## 23. Enums & Reference Data

```prisma
TransactionType  = EXPENSE | INCOME | TRANSFER
BudgetPeriod     = WEEKLY | MONTHLY | YEARLY | CUSTOM
RecurrenceFreq   = DAILY | WEEKLY | MONTHLY | YEARLY
AccountType      = CASH | BANK | SAVINGS | CREDIT_CARD | WALLET | INVESTMENT
CategoryType     = EXPENSE | INCOME | BOTH
NotificationType = BUDGET_THRESHOLD | BUDGET_EXCEEDED | GOAL_DEADLINE |
                   UNUSUAL_TRANSACTION | RECURRING_UPCOMING | AI_RECOMMENDATION |
                   REPORT_GENERATED
MessageRole      = USER | ASSISTANT | SYSTEM | TOOL
ReportType       = MONTHLY | QUARTERLY | YEARLY |
                   SPENDING_ANALYSIS | BUDGET | SAVINGS | FINANCIAL_HEALTH
```

Only `MONTHLY`/`QUARTERLY`/`YEARLY` are ever written (`report.service.mapType` passes the input
straight through). The other four `ReportType` values are **declared but unused** (CONFIRMED).
Likewise `RECURRING_UPCOMING` and `AI_RECOMMENDATION` have no producer (CONFIRMED — only 4
`createNotification` call sites exist, none using them).

**Static reference data** (`lib/constants/index.ts`): 16 expense categories, 5 income categories +
`Other Income` (22 total), 6 account types, 6 payment methods, 7 income sources,
budget alert thresholds `[50, 75, 90, 100]`, 8 goal categories, 12 chart colours,
page sizes `[20, 50, 100]`.

> ⚠ The UI uses these **constants**, not the DB `Category` table, for every dropdown
> (CONFIRMED `transactions/page.tsx`, `income/page.tsx`, `budgets/page.tsx`). They are two
> independent sources of truth (§43).

---

## 24. Database Access Patterns

- **Singleton client:** `lib/db/prisma.ts` exposes `globalThis.__prisma` in dev to survive HMR;
  standard Prisma recommendation (CONFIRMED).
- **Query styles:**
  1. Prisma CRUD with `include`/`select` for relation-heavy reads
  2. `groupBy` for type totals
  3. `aggregate` for sums (`_sum.amount`, `_sum.balance`)
  4. **Raw SQL** via `prisma.$queryRaw` / `Prisma.sql` template literals (parameterised) for
     month-bucketing in `health-score.ts`, `forecast.ts`, `affordability.ts`, and in
     `insight.service.ts` (Postgres `AGE()`, `DATE_PART()`)
- **Transactions:** `prisma.$transaction(async (client) => {...})` used for
  transaction create + balance adjust, and for recurring materialization (CONFIRMED).
- **Postgres-only:** `date_trunc`, `to_char`, `AGE()`, `DATE_PART()`, `numeric` aggregates ⇒
  SQLite/MySQL would break raw queries (CONFIRMED by syntax).
- **Driver:** `@prisma/client` requires a `pg` adapter for PostgreSQL, yet **no `pg` / `@prisma/adapter-pg`
  appears in `package.json`** (CONFIRMED). Prisma's built-in engine may still connect with the
  `connection_limit`/`?schema=` URL form; treat as `INFERRED` packaging concern rather than a defect —
  *unverified because the local DB was unreachable during this analysis.*

---

## 25. Migrations & Seeding

- **`prisma/migrations/` does not exist** (CONFIRMED). The schema has never been version-controlled
  as SQL migrations; only `db push` / `migrate dev` on demand. There is no migration history to
  replay, and CI cannot `prisma migrate deploy`.
- **`prisma/seed.ts` (519 lines, CONFIRMED) does:**
  1. `deleteMany()` on **every table** — including `user` ⇒ **wipes all tenants**, not just the demo one
  2. Creates demo user `demo@expensemanager.in` / password `Demo@123`
     (note: an unused `const PASSWORD = "Demo@1234"` sits at line ~6 — dead code)
  3. Creates `UserPreference`, `Profile` (with `monthlyIncome: 85000`)
  4. Creates **global system categories** — but types every one as `EXPENSE`, including
     Salary/Freelance/Business/Interest/Gift/Other Income (INFERRED defect: `CategoryType` mismatch
     vs `lib/constants` where they are `INCOME`), and sets `icon`/`color` to `null`
  5. Creates 4 accounts (HDFC Savings, ICICI Credit, Cash, Zerodha)
  6. Creates ~6 months of transactions with realistic merchants, plus 4 budgets, 5 goals,
     4 recurring rules, 6 notifications, and 1 `AIConversation`
- **README states the demo password as `Demo@123`** — matches the seed's actual hash; the
  `Demo@1234` constant is a red herring (CONFIRMED).
- Seeded goals carry `category` but **no `description`** → editing them from the UI fails (§43).

---

## 26. Service (Business Logic) Layer

`server/services/` — **13 `.service.ts` modules** (+ 3 `.types.ts`), with `server/analytics/` alongside; 2,445 lines total for `server/`.

| File | Responsibility |
|---|---|
| `transaction.service.ts` | CRUD, list w/ filters, duplicate, CSV import, balance adjust, post-create notifications |
| `account.service.ts` | CRUD, `getTotalBalance` |
| `category.service.ts` | CRUD + conflict checks + `ensureSystemCategories` |
| `budget.service.ts` | CRUD + list with live spent/remaining |
| `goal.service.ts` | CRUD, `mapGoal` (progress, overdue, required monthly saving), contributions |
| `goal-deadlines.service.ts` | 14-day deadline notifications, deduped |
| `recurring.service.ts` | CRUD + idempotent `processDueRecurrences` |
| `notification.service.ts` | create (with `dedupeKey`), list, unread count, mark read, mark all |
| `chat.service.ts` | AI conversation persistence |
| `insight.service.ts` | Pre-computed AI insight packets (raw SQL) |
| `report.service.ts` | Report generation + `REPORT_GENERATED` notification |
| `dashboard.service.ts` | Single aggregated dashboard payload (also runs housekeeping) |
| `audit.service.ts` | Fire-and-forget `audit()` writes |

**Rules of the layer:** no `Request`/`Response`, no React, `ApiError` only, `userId` on every query,
Prisma `$transaction` for multi-write operations.

---

## 27. Transaction & Money Logic

- **Balance delta** (`transaction.service.ts:104-109`): `EXPENSE → -amount`, `INCOME → +amount`,
  `TRANSFER → 0` (comment: *"TRANSFER between own accounts not double-counted in balance v1"*).
  ⚠ **Transfers never actually move money between accounts** — the source is not debited (CONFIRMED).
- Balance is applied to `Account.balance` inside the same `prisma.$transaction` (CONFIRMED).
- **Update path:** `PATCH /api/transactions/[id]` re-derives balance by reversing the old delta and
  applying the new one *(verify before editing — implementation reads `balanceDelta` twice)* (INFERRED).
- **Delete path:** reverses the stored delta (INFERRED from service shape).
- All money helpers in `lib/utils/money.ts`: `round2`, `safeDivide`, `percentChange`,
  `percentageOf`, `clamp`, `mean`, `stdDeviation`, `sum`.
- **Currency formatting is hardcoded** to `en-IN` / `INR` in `lib/utils/format.ts`:
  `formatCurrency`, `formatCompactCurrency` (₹K / ₹L / ₹Cr), `formatPercent`, `formatSignedPercent`,
  `formatDate`, `formatRelativeDate`, `toISODate`, `monthLabel`.
  → `UserPreference.currency` and `.dateFormat` are **written and never read** (CONFIRMED by grep).

---

## 28. Budget Logic

`server/analytics/budget-status.ts` (CONFIRMED):

```
spent      = SUM(Transaction.amount) WHERE type=EXPENSE
             AND transactionDate BETWEEN budget.startDate AND (budget.endDate ?? today)
             AND categoryId = budget.categoryId          [only if category-scoped]
utilization(%) = percentageOf(budget.amount, spent)      // round2, 0 when amount=0
remaining  = round2(amount - spent)
crossedThreshold(u) = 100 if u>=100 else 90 if u>=90 else 75 if u>=75 else 50 if u>=50 else null
```

- `period` (`WEEKLY|MONTHLY|YEARLY|CUSTOM`) is **stored but never used** to compute a window —
  the window is purely `startDate → endDate ?? today` (CONFIRMED).
- A `CUSTOM` budget requires `endDate` (zod refine) — enforced (CONFIRMED).
- **N+1:** one `aggregate` query *per budget* inside `Promise.all` (CONFIRMED `budget-status.ts:40-51`).
- Threshold notifications are deduped by `"<budgetId>:<startDate YYYY-MM-DD>:<threshold>"`
  so each threshold fires once per budget window (CONFIRMED `transaction.service.ts`).
- `crossedThreshold` is exported and unit-tested (`tests/budget.test.ts`, 5 tests).

---

## 29. Goal Logic

`server/services/goal.service.ts::mapGoal` (CONFIRMED):

```
remainingAmount       = max(0, target - current)
progressPct           = target>0 ? min(100, current/target*100) : 0
daysRemaining         = (deadlineDay - todayMidnight) / 86400000   [rounded]
overdue               = daysRemaining < 0 && remainingAmount > 0
requiredMonthlySaving = remainingAmount / max(1, ceil(daysRemaining/30))
                        [only when deadline set, daysRemaining > 0, remaining > 0]
```

- `currentAmount` can be raised via `PATCH { addContribution: n }` (positive only) — the UI's
  "Contribute" dialog uses this (CONFIRMED `goals/page.tsx:158`).
- `listGoals` orders by `createdAt asc`.
- Deadline notifications: window **14 days**, skipped when overdue or already complete, dedup key
  `goal:<id>:<YYYY-MM-DD>` (CONFIRMED `goal-deadlines.service.ts`).
- **Critical:** `deadline: null` in a PATCH is coerced by `z.coerce.date()` **before** the
  `z.literal(null)` branch can win → goal deadline becomes **1970-01-01** and the goal renders
  "Overdue". Verified by execution (CONFIRMED, §18).

---

## 30. Analytics & Health Scoring

All in `server/analytics/`, all deterministic.

| Module | Output |
|---|---|
| `ranges.ts` | `resolveRange(preset, start?, end?)` for 7 presets; `startOfWeek` uses **Monday-first** `(getDay()+6)%7` |
| `summary.ts` | income/expenses/net/savingsRate + previous-range comparison + `%` changes |
| `categories.ts` | category breakdown for a range |
| `trends.ts` | N-month income/expense series (dashboard uses 6) |
| `budget-status.ts` | see §28 |
| `detect.ts` | anomaly detection (see below) |
| `forecast.ts` | month-end projection from trailing complete months |
| `affordability.ts` | can_afford / potentially_risky / not_recommended |
| `health-score.ts` | weighted 0–100 score + grade |

**Savings rate** = `round2((income - expenses) / income * 100)`, 0 when income ≤ 0.

**Anomaly detection** (`detect.ts`, CONFIRMED):
- candidate = EXPENSE, last 30 days, `amount >= ₹500`, top 100
- history = same category, prior 90 days, up to 400 rows
- fires when `amount/avg >= 3×` **or** z-score `>= 3`
- needs ≥ 5 history rows
- reason string embeds ratio + typical amount; results capped at 10
- ⚠ `detectRecentAnomalies` issues **up to 100 sequential queries** (one per candidate) — worst-case N+1 (CONFIRMED).

**Forecast** (`forecast.ts`):
- trailing 4 complete months average → `expectedMonthly*`
- `projectedMonthEndExpenses = (currentExpenses / dayOfMonth) * daysInMonth` when `dayOfMonth > 2`,
  else falls back to the 4-month average
- `budgetsAtRiskOfOverrun` = `utilization * (daysInMonth / dayOfMonth) > 100`, skipped before day 3
- contains a **dead block**: an unused `budgetStatuses` query followed by `void budgetStatuses` (CONFIRMED)
- ⚠ a second unused query `budgetStatuses` (filtered `categoryId: null`) is fetched then voided — dead code

**Affordability** (`affordability.ts`):
- averages complete months (falls back to the partial current month)
- `can_afford` if `balance >= amount` and `amount <= 100% of monthly disposable`
- `potentially_risky` if `balance + disposable >= amount` and `amount <= 200% of disposable`
- else `not_recommended`
- `confidence` = high (≥2 months), medium (1), low (0)
- `activeGoalPressure` = any undated-future goal with remaining > 0

**Health score** (`health-score.ts`) — 6 weighted components:

| Component | Weight | Formula |
|---|---:|---|
| Savings Rate | 30 | `avgSavingsRate / 30 * 100` (30% is the "perfect" band) |
| Budget Adherence | 20 | `% of budgets with utilization <= 100` (defaults 70 if none) |
| Expense Growth | 15 | `100 + (prev-cur)/prev * 100` clamped (defaults 60 if either month missing) |
| Recurring Load | 10 | `100 - monthlyRecurring%income * 2` |
| Goal Progress | 15 | mean goal progress (defaults 50 if no goals) |
| Emergency Fund | 10 | `balance / (3 × avgMonthlyExpense) * 100` (defaults 50) |

Grade: `>=80 Excellent`, `>=65 Good`, `>=45 Fair`, else `Needs attention`.
⚠ The savings-rate component's "last 3 months" averaging is implemented loosely — an empty
`if` block with only a comment exists (`health-score.ts` around the `threeMonthsAgoStart` loop),
so current partial months are included (CONFIRMED dead branch).

---

## 31. Recurring Engine

`server/services/recurring.service.ts` (CONFIRMED):

- `processDueRecurrences(userId?)` selects `active && autoCreate && nextExecutionDate <= now`
  and `endDate` null-or-≥now, `take 200`.
- For each row, inside `prisma.$transaction`:
  - loop `cursor` from `nextExecutionDate` while `cursor <= now`, `guard < 24`
  - create a `Transaction` with `isRecurring: true` and `recurringTransactionId`
  - `advance()` by DAILY +1d / WEEKLY +7d / MONTHLY `setMonth(+1)` / YEARLY `setFullYear(+1)`
  - persist `nextExecutionDate = cursor`, `lastExecutedAt = now`
  - adjust `Account.balance` by `± amount * max(1, guard)`
- **Idempotency:** each run pushes `nextExecutionDate` past `now`, so a second run in the same
  request cannot double-create (CONFIRMED by design + comment).
- ⚠ `endDate` compare uses the *original* `now`, not the materialised `cursor` → a recurrence whose
  `endDate` passed mid-backfill still materialises the remaining slots (INFERRED).
- ⚠ `Math.max(1, guard)` would credit/debit **1×** even if the loop created 0 rows (edge case,
  nearly unreachable since `nextExecutionDate <= now` guarantees ≥1 iteration) (INFERRED).
- **Triggered only from** `getDashboardData()` via `Promise.allSettled` (CONFIRMED) — i.e. the engine
  runs when someone loads the dashboard, not on a cron. There is **no background job scheduler**.

---

## 32. Notifications & Audit Trail

**Creators (CONFIRMED — exactly 4 call sites):**

| Source | Types | Dedupe key |
|---|---|---|
| `transaction.service.afterExpenseCreated` | `BUDGET_THRESHOLD`, `BUDGET_EXCEEDED` | `<budgetId>:<startDate>:<threshold>` |
| `transaction.service.afterExpenseCreated` | `UNUSUAL_TRANSACTION` | `anomaly:<txId>` |
| `goal-deadlines.service` | `GOAL_DEADLINE` | `goal:<id>:<YYYY-MM-DD>` |
| `report.service` | `REPORT_GENERATED` | **none — not deduped** (every generated report notifies) |

- `createNotification` guard (CONFIRMED `server/services/notification.service.ts`): when
  `dedupeKey` is supplied it looks for an existing row with `userId`, `read: false`, and
  `metadata: { path: ["dedupeKey"], equals: <key> }`; if found it returns `null` and skips the
  insert. The key itself is written into `metadata` as `{ dedupeKey }`.
  → **Dedupe only applies while the notification is still unread.** Once the user reads it, the
  same key can fire again.
- `notifyBudget`/`notifyGoal`/`notifyAIInsight`/`notifyRecurring` preference flags are stored
  but **never consulted** by any creator (CONFIRMED by grep) → toggles in Settings are inert.
- **`markNotificationRead()` (single-notification) exists in the service but is imported by
  zero routes** — the only handler on `/api/notifications/[id]` is `DELETE`. That is why the UI
  has no correct "mark one read" option (CONFIRMED by grep).

**Read paths:** `GET /api/notifications?page=&pageSize=` (paged; `page`/`pageSize` are
`Number()`-coerced manually and **not** zod-validated), `unreadNotificationCount` for the bell,
and two equivalent mark-all-read routes — `PATCH /api/notifications` (**no UI caller**) and
`POST /api/notifications/read-all` (**used by `app/(app)/notifications/page.tsx:70`**).

**Destructive misuse:** the UI's "mark as read" button calls `DELETE /api/notifications/[id]`,
which permanently deletes the row (`app/(app)/notifications/page.tsx` and `components/shell.tsx`)
(CONFIRMED).

**Audit trail:** `audit()` writes `userId, action, entity, entityId, metadata` — **no IP is
stored** (there is no `ip` column). The action is a closed string union defined in
`server/services/audit.service.ts` (`REGISTER, LOGIN, LOGOUT, CREATE_TRANSACTION,
UPDATE_TRANSACTION, DELETE_TRANSACTION, IMPORT_TRANSACTIONS, CREATE_BUDGET, UPDATE_BUDGET,
DELETE_BUDGET, CREATE_GOAL, UPDATE_GOAL, DELETE_GOAL, CREATE_ACCOUNT, DELETE_ACCOUNT,
AI_REPORT_GENERATED, PASSWORD_CHANGED, ACCOUNT_DELETED`). Writes are fire-and-forget and
swallow their own errors. **There is no reader endpoint, no retention policy, and `userId` is
nullable** (`AuditLog.user` is `SetNull`) (CONFIRMED).

---

## 33. AI Subsystem Architecture

`agents/` — 9 files, 1,331 lines (CONFIRMED):

```
app/(app)/ai/page.tsx
   └─ POST /api/ai/chat  ──► agent-runner.runAgentChat()
                                 │
                                 ├─ intent-agent      classify user intent
                                 ├─ planner-agent     turn intent → tool plan
                                 ├─ tools             execute against services
                                 ├─ analysis-agent    numeric analysis
                                 ├─ decision-agent    produce recommendation
                                 ├─ report-agent      structured output
                                 ├─ prompts           prompt templates
                                 └─ provider          OpenAI-compatible HTTP client
```

- `provider.ts` reads `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` from env (CONFIRMED via schema/env list).
- Hard architectural rule repeated across `agents/` and `server/analytics/`: **the model narrates,
  it does not compute.** Numbers come from `server/analytics/*`.
- Rate limit: 20 chats/minute/user (§20).
- `runAgentChat` accepts an optional `conversationId`; the schema allows it (`aiChatSchema`).

**⚠ Session continuity is broken in practice:** `app/(app)/ai/page.tsx` never sends `conversationId`
and never receives/stores one → **every message creates a brand-new `AIConversation` + `AIMessage`
rows, and no prior context is injected** (CONFIRMED by grep: no `conversationId` in `ai/page.tsx`).
Consequences: chat history unusable, DB growth per message, and the model always starts blind.

---

## 34. AI Provider, Prompts & Tools

- Provider = OpenAI-compatible chat-completions over `AI_BASE_URL` (INFERRED from env names
  `AI_BASE_URL`/`AI_MODEL`/`AI_API_KEY` + `provider.ts` — not executed here, no live key test).
- Prompts are centralized in `agents/prompts.ts` (CONFIRMED existence; templates not reproduced here).
- Tool layer (`agents/tools.ts`) is the bridge to `server/services` + `server/analytics`
  (CONFIRMED existence).
- Fallbacks: if `AI_API_KEY` is absent, chat must degrade — **not verified** (UNKNOWN; no live run).
- No streaming (`text/event-stream`) anywhere; responses are single JSON payloads (CONFIRMED —
  no `ReadableStream` in `agents/` or `app/api/ai/**`).
- No token counting, no cost metering, no prompt-injection defence beyond "never let the model
  compute numbers" (INFERRED).

---

## 35. Reporting Subsystem

- `POST /api/ai/reports` with `reportGenerateSchema`:
  `type ∈ MONTHLY|QUARTERLY|YEARLY` + `year (2000–2100)` + `month` (required iff MONTHLY) +
  `quarter` (required iff QUARTERLY) — two `.refine()` guards (CONFIRMED).
  The handler resolves `range` via `resolveReportRange(input)` and passes it to
  `generateReportForUser(userId, {...input, range})` (CONFIRMED `app/api/ai/reports/route.ts`).
- `resolveReportRange`: MONTHLY → `new Date(y, m-1, 1)` … `endOfMonth`; QUARTERLY →
  start month `(q-1)*3`, end `(y, startMonth+3, 0, 23:59:59.999)`; YEARLY → Jan 1 … Dec 31.
- `reportGenerateSchema` is also exported from `lib/validation/schemas.ts` (shared) (CONFIRMED).
- Generation pipeline (`server/services/report.service.ts`, CONFIRMED):
  1. `collectReportStatistics(userId, range, periodLabel)` → `agents/report-agent`
  2. `reportDataAvailability(stats)` → `{ …availability }`
  3. `narrateReport(stats, availability)` → `{ executiveSummary, … }` (LLM)
  4. Persist `AIReport { type, startDate, endDate, title, summary, content(Json),
     healthScore, metadata }`
  5. `createNotification(type: "REPORT_GENERATED", link: "/reports")` — **no dedupe key**, so every
     generation notifies (CONFIRMED `report.service.ts:104`).
  6. Return `{id, type, title, summary, healthScore, startDate, endDate, createdAt, report}`
- `content` shape: `{ period, availability, overview, categories[≤8], budgets, goals,
  recurringMonthlyLoad, anomalies[≤5], healthScore, narrative }` (CONFIRMED).
- Title convention: `"January 2026 Monthly Report"` / `"Q1 2026 Quarterly Report"` /
  `"2026 Yearly Report"`; `mapType()` passes `MONTHLY|QUARTERLY|YEARLY` straight through, so the
  four extra `ReportType` enum values are never written.
- `GET /api/ai/reports` lists; `GET /api/ai/reports/[id]` fetches via `getReportOrThrow`
  (**no UI caller**); `DELETE /api/ai/reports/[id]` removes (UI uses this).
- **Auth on the single-report route is CONFIRMED correct** — both `GET` and `DELETE` call
  `handleRoute` + `requireUserId()` + `getReportOrThrow(userId, params.id)` / `deleteReport(userId, …)`.

---

## 36. Frontend Architecture & State Management

- **No global state library** (no Redux/Zustand/Jotai/React Query). Pure React `useState` +
  `useEffect` + `useCallback` per page (CONFIRMED).
- **Data fetching:** raw `fetch(...).then(r => r.json())` in every page; a small shared
  `ApiResponse<T>` type in `types/api.ts` used for typing only.
- **No caching, no SWR, no revalidation** → every navigation refetches everything (CONFIRMED).
- **Optimistic updates:** none; every mutation ends with an explicit `fetchX()` refetch.
- **Server components:** only the layouts (`(app)/layout.tsx`, `app/layout.tsx`) are async
  server components. All 10 app pages are `"use client"` (CONFIRMED) → all data loading happens
  client-side, so **first paint shows skeletons**, and every page is a client bundle.
- **Toasts:** custom `ToastProvider` via `createPortal` + framer-motion, 4 s auto-dismiss,
  `useToast()` throws outside the provider (CONFIRMED `components/ui/toast.tsx`).
- **Toasts are the only feedback channel** — no inline field-level errors; zod messages surface
  as a single toast.
- **Forms:** plain controlled `<form onSubmit>` + `disabled={formSubmitting}`; no react-hook-form.

---

## 37. Design System & Component Library

**Tokens** (`app/globals.css`, CONFIRMED): HSL triplets in CSS variables, `--radius: 0.75rem`,
semantic colour roles `background/foreground/card/primary/secondary/muted/accent/destructive/border/input/ring`
plus custom `--success` and `--warning`. Dark mode via `.dark` class.

**Brand:** primary `hsl(142 76% 36%)` — a saturated **green**; ring matches primary.
This is the money/growth palette (INFERRED).

**Tailwind extension** (`tailwind.config.ts`): centered container (2xl: 1280px, 1.5rem padding),
Inter font stack, `success`/`warning` colours, radius scale derived from `--radius`,
keyframes `fade-in`, `slide-up`, `shimmer`, `pulse-soft`.

**Primitives** (`components/ui/`, **18 files**): `avatar, badge, button, card, checkbox, dialog,
dropdown-menu, input, label, progress, select, separator, skeleton, switch, tabs, textarea, toast,
tooltip` (note: `toast.tsx` is the toast system, not a Radix toaster; `textarea` and `tooltip` have
**zero importers**).

Usage counts (importing files): `card` 14, `button` 13, `toast` 11, `skeleton` 9, `label` 9,
`badge` 8, `dialog` 7, `select` 7, `input` 10, `progress` 2, `avatar`/`checkbox`/`dropdown-menu`/
`separator`/`switch`/`tabs` 1 each.

- `button` = CVA with variants `default | destructive | outline | secondary | ghost | link`
  and sizes `default | sm | lg | icon` (CONFIRMED).
- **`select.tsx` is a native `<select>` wrapper, not a Radix Select** — no portal, no typeahead,
  no a11y menu semantics beyond a native control (CONFIRMED).
- **`progress.tsx` uses `translateX(-${100 - value}%)`** on a full-width child, so at `value=0` the
  bar is still translated `-100%` (correct) — but `value > 100` overflows visually with no clamp
  (INFERRED; budgets routinely exceed 100%).
- `avatar.tsx` uses raw `<img>` → the only lint warning in the repo (CONFIRMED).

---

## 38. Visualization & Theming

- **Recharts** used on `/dashboard` (donut category breakdown, 6-month trend) and `/analytics`
  (larger chart set) (CONFIRMED by route contents).
- Chart palette `CHART_COLORS` — 12 hex values in `lib/constants/index.ts`.
- Charts are client-rendered inside `"use client"` pages → no SSR chart markup (INFERRED).
- **Theming:** `next-themes` with `attribute="class"` wiring through `components/theme-provider.tsx`
  and a toggle in `components/shell.tsx` (CONFIRMED). Preference also persists
  `UserPreference.theme` (`light|dark|system`) via `/api/preferences` — **whether the two are synced
  is UNKNOWN** (next-themes keeps its own `localStorage` key).
- No reduced-motion handling beyond Tailwind defaults (INFERRED).

---

## 39. Testing Strategy & Quality Gates

`vitest.config.ts` + `tests/` (5 files, 67 tests, all passing):

| File | Tests | Covers |
|---|---:|---|
| `tests/money.test.ts` | 17 | `round2`, `safeDivide`, `percentChange`, `percentageOf`, `mean`, `stdDeviation`, `sum`, `clamp` |
| `tests/intent.test.ts` | 20 | AI intent classification |
| `tests/validation.test.ts` | 19 | zod schemas (incl. cuid-shaped IDs — which is exactly why the UI's *names* are not caught) |
| `tests/goal.test.ts` | 6 | `mapGoal` progress/overdue/required saving |
| `tests/budget.test.ts` | 5 | `crossedThreshold` |

**Coverage reality (CONFIRMED):**
- ✅ Pure functions are well covered.
- ❌ **Zero integration/API tests** — no route handler is ever invoked.
- ❌ **Zero UI tests** — no Playwright/Cypress/Testing Library at all.
- ❌ **No test exercises a page's actual request payload**, so the 8 payload/schema mismatches in
  §43 passed CI undetected.
- No coverage thresholds, no CI config (`.github/` absent), no pre-commit hooks.

**Quality gates that do exist and currently pass:** `tsc --noEmit` ✅ · `next lint` ✅ (1 warning) ·
`vitest run` ✅ 67/67.

---

## 40. Environment, Build & Deployment

`.env.example` / `.env` variable names (values redacted; **`.env` is gitignored but present on disk**):

| Var | Used by | Required |
|---|---|---|
| `DATABASE_URL` | `lib/db/prisma.ts` | yes |
| `AUTH_SECRET` | `lib/auth/jwt.ts` | **should be** — falls back to a hardcoded dev string |
| `AI_API_KEY` | `agents/provider.ts` | for AI features |
| `AI_MODEL` | `agents/provider.ts` | for AI features |
| `AI_BASE_URL` | `agents/provider.ts` | for AI features |
| `NEXT_PUBLIC_APP_URL` | client | cosmetic |

- `next.config.mjs`: `reactStrictMode: true`, `poweredByHeader: false`. **No security headers, no
  CSP, no `X-Frame-Options`, no HSTS, no image domains config** (CONFIRMED).
- Build: `prisma generate && next build`. `.next/` exists but **`BUILD_ID` is absent** → it is a
  dev/HMR artefact, not a completed production build (CONFIRMED).
- **DB unreachable during this analysis:** `Can't reach database server at localhost:5432` —
  so no runtime end-to-end verification was possible (CONFIRMED by executing a Prisma probe).
- No Dockerfile, no `vercel.json`, no CI, no process manager, no cron/systemd unit (CONFIRMED by
  root listing).

---

## 41. Security Posture & Findings

Full detail in `docs/SECURITY.md`. Summary (CONFIRMED unless noted):

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | **High** | `AUTH_SECRET` has a hardcoded public fallback → token forgery if unset | `lib/auth/jwt.ts:5-7` |
| S2 | High | 30-day non-revocable JWT; password change/account delete does **not** invalidate sessions | `lib/auth/jwt.ts`, no denylist |
| S3 | High | `npm audit` → 1 critical + 1 high (`next@14.2.35` RCE/cache-poisoning/SSRF advisories, `postcss`) | `npm audit --omit=dev` |
| S4 | Medium | Rate-limit IP from spoofable `x-forwarded-for`, `?? "local"` fallback merges all clients | `app/api/auth/login/route.ts` |
| S5 | Medium | In-memory rate limiter — no-op across restarts/multi-instance | `lib/api/rate-limit.ts` |
| S6 | Medium | `DELETE /api/account` requires **no password confirmation** | `app/api/account/route.ts` |
| S7 | Medium | API auth relies on 55 handlers each remembering `requireUserId()`; middleware excludes `/api` | `middleware.ts` |
| S8 | Medium | No security headers (CSP/XFO/HSTS/frame-ancestors) | `next.config.mjs` |
| S9 | Medium | `seed.ts` `deleteMany()` on all tables — destroys every user, not just demo | `prisma/seed.ts` |
| S10 | Low | `avatarUrl` is any URL; rendered via raw `<img>` (no sanitisation) | `components/ui/avatar.tsx` |
| S11 | Low | Notification `metadata` is user-influenced JSON stored raw | `prisma/schema.prisma` |
| S12 | Low | `page`/`pageSize` on notifications unvalidated → `NaN` could reach Prisma | `app/api/notifications/route.ts` |
| S13 | Low | No audit-log reader → no user-visible access history | grep |

**Positives (CONFIRMED):** bcrypt(10), `httpOnly`+`SameSite=Lax`+prod `Secure` cookies, identical
401 message for unknown email vs wrong password, parameterised raw SQL, `userId` predicate on every
query, `cuid` IDs, zod on all mutating bodies, `poweredByHeader:false`, no secrets in code except the
S1 fallback.

**OWASP mapping:** A01 Broken Access Control — largely mitigated (§15). A02 Cryptographic Failures —
S1/S2. A03 Injection — mitigated (zod + parameterised SQL). A05 Security Misconfiguration — S8.
A06 Vulnerable Components — S3. A07 Auth Failures — S4/S5, no MFA, no reset flow.

---

## 42. Performance & Scalability Profile

| Issue | Severity | Evidence |
|---|---|---|
| `getBudgetStatuses` issues one `aggregate` **per budget** | Medium | `budget-status.ts:40-51` |
| `detectRecentAnomalies` issues up to **100 sequential** history queries | High | `detect.ts:63-70` |
| Dashboard fires ~10 parallel queries + recurring + deadline housekeeping on **every load** | Medium | `dashboard.service.ts` |
| `getBudgetStatuses` called redundantly by dashboard, reports, health-score, forecast | Medium | cross-file grep |
| No pagination on goals/notifications-list beyond fixed sizes; export loads **10,000** rows in one query | Low-Med | `app/api/export/route.ts` |
| Every page is a client component → full client bundle + skeleton flash | Medium | all `app/(app)/**/page.tsx` |
| `recharts` + `framer-motion` in the client graph on pages that need them (route-split by App Router) | Low | `package.json` |
| No SWR/React Query → refetch on every mount, no request dedup | Medium | §36 |
| `processDueRecurrences` runs on dashboard GET → GET has side effects (also a cache/CORS concern) | Medium | `dashboard.service.ts:41-44` |
| In-memory rate-limit `Map` unbounded until 10k keys | Low | `rate-limit.ts:18-21` |
| Prisma singleton is correct for dev HMR | Positive | `lib/db/prisma.ts` |
| Raw SQL month-bucketing avoids JS post-processing | Positive | `forecast.ts`, `health-score.ts` |
| Single aggregated `/api/dashboard` payload instead of 8 round-trips | Positive | `dashboard.service.ts` |

**Scaling ceiling:** single-node, in-memory rate limiting; no Redis; no queue; no read replica;
raw SQL is Postgres-only. Realistic target = **one small VPS for one to a few hundred users** (INFERRED).

---

## 43. Code Health: Bugs, Dead Code, Gaps

### 43.1 Confirmed functional bugs (UI ↔ API contract mismatches)

All verified by executing the project's own `zod@3.25.76` against the exact payloads the pages send.

| ID | Sev | Bug | Evidence |
|---|---|---|---|
| **B1** | **Critical** | **Add/Edit Transaction always 400** — the form posts `categoryId` as the category *name* (`"Food"`), but `transactionCreateSchema` requires a `cuid`. Every create and edit from `/transactions` fails with "Category is required" (create) / "Invalid cuid" (edit). | `app/(app)/transactions/page.tsx:162` + option values at `:451-455`; `lib/validation/schemas.ts` `transactionBase` |
| **B2** | **Critical** | **Add Income always 400** — identical name-as-cuid bug. | `app/(app)/income/page.tsx:112`, `:257-258` |
| **B3** | **Critical** | **Edit Budget always 400** — submit sends `categoryId: formCategoryId \|\| null`; `openEdit` resets `formCategoryId` to `""` → always `null`; `budgetUpdateSchema.categoryId` is `z.string().cuid().optional()` with **no** `null` branch → `Invalid input`. | `app/(app)/budgets/page.tsx:91`, `:77`; `app/api/budgets/[id]/route.ts:8-15` |
| **B4** | High | **Create Budget fails whenever a category is chosen** — `categoryId` is the category name → `Invalid cuid`. Works only if no category is selected. | `budgets/page.tsx:91`, `:244`; executed zod test |
| **B5** | High | **Create Goal fails** unless *both* category and description are non-empty — page always sends `category: null` and `description: null`; `optionalTrimmed` rejects `null`. The description field is even labelled "Optional". | `app/(app)/goals/page.tsx:129-130`; executed zod test |
| **B6** | High | **Edit Goal fails** for the same reason; additionally a cleared deadline is coerced to **1970-01-01** (epoch) making the goal permanently "Overdue". Seeded goals have `category` set but `description: null` → they can never be edited. | `goals/page.tsx:128-130`; `schemas.ts` `goalCreateSchema`; executed zod test |
| **B7** | High | **"Mark as read" actually deletes** — both the notifications page and the bell dropdown call `DELETE /api/notifications/[id]`. No mark-one-read endpoint is called. | `app/(app)/notifications/page.tsx`, `components/shell.tsx` |
| **B8** | Medium | **Transactions category filter is a silent no-op** — filter sends the name as `categoryId`; `transactionQuerySchema` rejects it → 400 → the page's `.then` swallows it and the list stays unfiltered. | `transactions/page.tsx:95`, `:266-273`; executed zod test |
| **B9** | Medium | **AI chat never resumes a conversation** — `conversationId` is never sent; a new `AIConversation` is created per message, no history is provided to the model. | `app/(app)/ai/page.tsx` (grep) |
| **B10** | Medium | **Edit Budget silently drops the category** even ignoring B3 — `openEdit` hardcodes `setFormCategoryId("")` instead of the existing `b.categoryId`. | `budgets/page.tsx:77` |
| **B11** | Low | **Settings → "Delete Account" is a no-op** — it toasts "not yet implemented" although `DELETE /api/account` exists and is functional. | `app/(app)/settings/page.tsx` (~line 314 area) |
| **B12** | Low | Landing page `/` shows **hardcoded fake statistics and a scripted demo chat** that is not backed by any API. | `app/page.tsx` |
| **B13** | Low | `TRANSFER` transactions update neither source nor destination balance (documented "v1" caveat, but users see a zero-impact transfer). | `transaction.service.ts:104-109` |

### 43.2 Dead / unreachable code

| Item | Status |
|---|---|
| `app/(marketing)/layout.tsx` | dead — no page in the group |
| `date-fns` dependency | declared, never imported |
| `components/ui/textarea.tsx`, `tooltip.tsx` | never imported |
| `lib/constants` `BUDGET_ALERT_THRESHOLDS` | defined, unused (thresholds hardcoded in `crossedThreshold`) |
| `UserPreference.currency`, `dateFormat` | written, never read (`format.ts` hardcodes INR/en-IN) |
| `UserPreference.notifyBudget/Goal/AIInsight/Recurring` | written, never read |
| `Profile.monthlyIncome` | written by onboarding/settings, never read by any calculation |
| `DashboardData.hasAnyData` | computed, unused by the page |
| `forecast.ts` `budgetStatuses` + `void budgetStatuses` | fetched then discarded |
| `health-score.ts` empty `if` block with comment only | dead branch |
| `prisma/seed.ts` `const PASSWORD = "Demo@1234"` | unused |
| `NEXT_PUBLIC_APP_URL` | present in env, unused in code (INFERRED) |

### 43.3 Backend-complete features with **zero UI**

| Feature | API | UI |
|---|---|---|
| Accounts CRUD | `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/[id]` | ❌ none — **new users can never create an account**, so "Total Balance" stays ₹0 forever |
| Categories CRUD | `GET/POST /api/categories`, `PATCH/DELETE /api/categories/[id]` | ❌ none |
| Recurring transactions | full CRUD | ❌ none |
| CSV import | `POST /api/transactions/import` | ❌ none (export exists) |
| Duplicate transaction | `POST /api/transactions/[id]/duplicate` | ❌ none |
| Delete account | `DELETE /api/account` | ⚠ button exists but is stubbed (B11) |
| Export budgets | `GET /api/export?type=budgets` | ❌ only transactions export is linked |
| AI insights | `GET /api/ai/insights` | ❌ none |
| AI analysis | `POST /api/ai/analyze` | ❌ none |
| Fetch single report | `GET /api/ai/reports/[id]` | ❌ none |
| Audit log | write-only | ❌ no reader route, no UI |

### 43.4 Dual sources of truth

1. **Categories:** `lib/constants/*_CATEGORIES` (used by every dropdown) vs `Category` rows in the DB
   (used by budgets/transactions relations). The two can diverge; budgets created with a name-based
   `categoryId` never persist at all (B4), so in practice the DB category set only exists for seeded data.
2. **Notifications read:** `PATCH /api/notifications` (mark all) vs `POST /api/notifications/read-all`
   — identical behaviour, two routes.
3. **Theme:** `next-themes` localStorage vs `UserPreference.theme`.

### 43.5 UX friction

- No inline validation errors — zod messages arrive only as a toast.
- 401 session expiry produces "Something went wrong" instead of a redirect to login.
- Onboarding never collects `occupation` or `account` although the API supports both →
  a brand-new user has **zero accounts**.
- Onboarding always re-runs for a user with `onboardedAt` empty; there is no "skip".
- Pagination resets on filter change via a second `useEffect` — acceptable but can flicker.
- `progress.tsx` does not clamp >100% (budgets routinely exceed 100%).
- No bulk select/delete, no undo (deletes are immediate, no confirmation dialog on some pages).

### 43.6 Documentation state

- `README.md` exists and documents setup, env, scripts, architecture (CONFIRMED).
- No `docs/` folder existed before this analysis (created now).
- No API reference, no ERD, no ADRs, no CONTRIBUTING.

---

*End of the 43-section analysis. Next: `docs/AI_PROJECT_CONTEXT.md` (master context + specification),
then `docs/ROADMAP.md`.*
