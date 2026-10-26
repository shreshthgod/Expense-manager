# Architecture

Read-only reverse-engineered description of how `expense-manager` is wired.
Evidence markers: **C** = confirmed by source, **I** = inferred, **U** = unknown.

---

## 1. Layering

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (client pages, "use client")                           │
│  fetch() + useState/useEffect  →  ApiResponse<T> envelope        │
└───────────────┬──────────────────────────────────────────────────┘
                │  JSON
┌───────────────▼──────────────────────────────────────────────────┐
│  middleware.ts        page-level auth gate (matcher excludes /api)│
│  app/api/**/route.ts  55 handlers: requireUserId → zod → service  │
│                       handleRoute() → {success,data|error}        │
├──────────────────────────────────────────────────────────────────┤
│  server/services/**    business logic, ApiError, userId-scoped    │
│  server/analytics/**   pure deterministic calculations           │
├──────────────────────────────────────────────────────────────────┤
│  agents/**             AI orchestration (never computes numbers) │
├──────────────────────────────────────────────────────────────────┤
│  lib/db/prisma.ts      singleton PrismaClient                    │
│  PostgreSQL            raw SQL only for month bucketing          │
└──────────────────────────────────────────────────────────────────┘
```

**Key invariant (C):** `server/**` never imports `Request`/`Response`/React. HTTP concerns stop
at `app/api/**`. Analytics functions are pure with respect to HTTP and only read the DB.

**Supporting libraries (`lib/`)** — shared by all layers:

| Module | Role |
|---|---|
| `lib/db/prisma.ts` | singleton client (`globalThis.__prisma` in dev) |
| `lib/auth/jwt.ts` | HS256 sign/verify, `SESSION_COOKIE_NAME = "em_session"`, 30-day TTL |
| `lib/auth/password.ts` | bcrypt hash/compare (10 rounds) |
| `lib/auth/session.ts` | `setSessionCookie`, `clearSessionCookie`, `getSessionUserId`, `getCurrentUser` (React `cache()`) |
| `lib/api/auth.ts` | `requireUserId()` used by all 55 handlers |
| `lib/api/response.ts` | `handleRoute`, `ok`, `created`, `fail`, `readJson` |
| `lib/api/errors.ts` | `ApiError` + factory methods |
| `lib/api/rate-limit.ts` | in-memory sliding window |
| `lib/validation/schemas.ts` | 23 zod schemas |
| `lib/constants/index.ts` | categories, account types, thresholds, palette |
| `lib/utils/{cn,money,format}.ts` | helpers |

---

## 2. Routing model

### Page routes (14)

```
/                     public  (marketing, hardcoded demo content)
/login                public  (redirect → /dashboard if session)
/register             public  (redirect → /dashboard if session)
/onboarding           protected, standalone layout (no Shell)
/dashboard            ┐
/transactions         │
/income               │
/budgets              │  protected → app/(app)/layout.tsx → <Shell>
/goals                │
/analytics            │
/ai                   │
/reports              │
/notifications        │
/settings             ┘
```

Route groups:
- `(auth)` — centered card layout, no nav (C)
- `(app)` — server layout resolves the user then renders `components/shell.tsx` (C)
- `(marketing)` — **contains only `layout.tsx`, no `page.tsx` → dead group** (C)
- `onboarding` and `app/page.tsx` sit outside all groups (C)

### API routes (36 files / 55 handlers)

Grouped as: `auth(3) · onboarding(1) · profile(3) · preferences(2) · account(1) · accounts(4) ·
transactions(6) · income(2) · categories(4) · budgets(4) · goals(4) · recurring(4) ·
notifications(4) · dashboard(1) · analytics(3) · export(1) · ai(7)`.

Full table: `docs/API.md`.

---

## 3. Request lifecycle

### A page load (e.g. `/dashboard`)
1. `middleware.ts` verifies `em_session` → no token ⇒ redirect `/login?next=/dashboard` (C)
2. `app/(app)/layout.tsx` runs `getCurrentUser()` (React-cached) → null ⇒ `redirect("/login")` (C)
3. `<Shell user>` renders sidebar + topbar (client component, serialised user prop) (C)
4. `app/(app)/dashboard/page.tsx` (client) fetches `/api/dashboard` (C)
5. `GET /api/dashboard` → `requireUserId()` → `getDashboardData(userId)` (C)

### `GET /api/dashboard` internals (C — `server/services/dashboard.service.ts`)
```
Promise.allSettled([ processDueRecurrences, checkGoalDeadlines ])   ← housekeeping, side effects
Promise.all([
  getTotalBalance, getFinancialSummary, getCategoryBreakdown,
  getMonthlyTrend(6), getBudgetStatuses, recent 8 transactions,
  listAccounts, unreadNotificationCount, anyTx?boolean
]) → DashboardData { totalBalance, summary, categoryBreakdown, monthlyTrend,
                     budgets, recentTransactions, accounts,
                     unreadNotifications, hasAnyData }
```
> ⚠ A **GET request mutates data** (recurring materialisation + notification creation). Idempotent
> by design, but it breaks the usual "GET is safe" expectation for caches/proxies. (C)

### A mutation (e.g. `POST /api/transactions`)
1. Handler: `requireUserId()` → `transactionCreateSchema.parse(await readJson(request))`
2. On `ZodError` → `handleRoute` returns `400 VALIDATION_ERROR` with per-field `details`
3. `createTransaction(userId, input)` → `prisma.$transaction`: insert row + `Account.balance` increment
4. `audit({action:"CREATE_TRANSACTION"})`
5. `afterExpenseCreated(...)` — budget threshold + anomaly notifications, **errors swallowed** (C)
6. `created(dto, "Transaction created")`

---

## 4. Authentication architecture

```
register/login
   ├─ enforceRateLimit(ip-key)
   ├─ zod parse
   ├─ bcrypt verify            → 401 INVALID_CREDENTIALS (same msg for unknown user)
   ├─ audit()
   └─ cookies().set("em_session", <HS256 JWT>, {
        httpOnly: true, sameSite: "lax", path: "/",
        secure: NODE_ENV==="production", maxAge: 30d
      })

middleware.ts  → page routes only (matcher excludes /api and assets)
requireUserId()→ every API handler (lib/api/auth.ts)
```

- Token payload: `{ sub: userId }` + `iat` + `exp` (30 days) (C)
- **No refresh, no revocation list, no `jti`** — a password change does not invalidate old tokens (C)
- `getSecretKey()` falls back to a **hardcoded dev string** when `AUTH_SECRET` is missing (C)
- API routes are **not** covered by middleware; protection is per-handler convention (C)

---

## 5. Data-access patterns

| Pattern | Where |
|---|---|
| CRUD with `include`/`select` | all services |
| `groupBy` by `type` | `analytics/summary.ts` |
| `aggregate _sum` | balance, budget spent, account totals |
| `prisma.$queryRaw` / `Prisma.sql` | month bucketing in `health-score`, `forecast`, `affordability`, `insight.service` |
| `prisma.$transaction(async client => …)` | transaction create + balance, recurring materialisation |
| `findMany` + JS mapping | goals (`mapGoal`), recurring (`map`), transactions (`mapTransaction`) |
| Ownership guard | `findFirst({id, userId})` **or** `deleteMany({id, userId})` + `count===0 → 404` |

Postgres-only SQL: `date_trunc`, `to_char`, `AGE()`, `DATE_PART()`, `numeric` aggregates. (C)

---

## 6. Frontend architecture

- **100% client pages.** Only `app/layout.tsx`, `(auth)/layout.tsx`, `(app)/layout.tsx` are server
  components. Every app page is `"use client"`. (C)
- **No global store, no data library** — raw `fetch` + `useState`/`useEffect`/`useCallback`. (C)
- **No caching / SWR / React Query** — full refetch on every mount. (C)
- **Feedback:** custom `ToastProvider` (portal + framer-motion, 4 s auto-dismiss). Toasts are the
  only error channel; there is no inline field validation. (C)
- **Forms:** plain `<form onSubmit>` with `disabled={formSubmitting}`. (C)
- **Mutations always refetch** the list afterwards; no optimistic UI. (C)

---

## 7. AI subsystem architecture

```
app/(app)/ai/page.tsx
  └─ POST /api/ai/chat  (rate limit 20/min/user, aiChatSchema)
       └─ agents/agent-runner.runAgentChat({userId, message, conversationId?})
            ├─ intent-agent      classify intent
            ├─ planner-agent     intent → tool plan
            ├─ agents/tools.ts   execute against server/services + server/analytics
            ├─ analysis-agent    interpret computed numbers
            ├─ decision-agent    recommendation
            ├─ report-agent      structured output
            ├─ agents/prompts.ts templates
            └─ agents/provider.ts  OpenAI-compatible HTTP (AI_API_KEY / AI_MODEL / AI_BASE_URL)
```

Governing rule, repeated in `server/analytics/health-score.ts`, `forecast.ts`, `affordability.ts`
and `agents/`: **the model may explain a number but may never produce one.** (C)

Known gap: `app/(app)/ai/page.tsx` never sends `conversationId`, so every message opens a fresh
`AIConversation` and the model receives no history. (C)

---

## 8. Design-system architecture

```
app/globals.css      :root { --background … --success --warning --radius: .75rem }
                       .dark { … }                       (HSL triplets)
tailwind.config.ts   darkMode:"class", colors → hsl(var(--*)),
                       radius scale from --radius, Inter,
                       animations: fade-in, slide-up, shimmer, pulse-soft
components/ui/*      18 primitives (button uses CVA variants/sizes)
components/shell.tsx sidebar + topbar + theme toggle + bell
```

Note: `components/ui/select.tsx` is a **native `<select>` wrapper**, not a Radix select. (C)

---

## 9. Cross-cutting concerns

| Concern | Implementation | Caveat |
|---|---|---|
| Validation | zod on every mutating body; query validated only for transactions | notifications `page`/`pageSize` unvalidated |
| Errors | `handleRoute` funnel: `ZodError→400`, `ApiError→own code`, else `500` | client shows one generic toast |
| Rate limiting | in-memory `Map`, login 15/min, register 10/min, chat 20/min | single-node; `x-forwarded-for` spoofable |
| Audit | `audit()` → `AuditLog` | write-only, no reader route |
| Theming | next-themes + `UserPreference.theme` | two sources of truth, sync unknown |
| Idempotency | recurring engine advances `nextExecutionDate` past `now` | `endDate` compared against wall-clock, not cursor |
| Job scheduling | **none** — recurring/deadline work runs inside dashboard GET | no cron |

---

## 10. Build & deployment topology

- Build: `prisma generate && next build` (C)
- `next.config.mjs`: `reactStrictMode: true`, `poweredByHeader: false`. **No security headers.** (C)
- `middleware.ts` matcher: `/((?!api|_next/static|_next/image|favicon.ico|.*\.(png|jpg|jpeg|svg|ico|webp)).*)`
- No Dockerfile, no CI config, no `.github/`, no process manager (C)
- No `prisma/migrations/` directory — schema is pushed, never versioned as SQL (C)
- `.env` is gitignored but present on disk with live values (C)

**Implied deployment shape:** one container/VM + one Postgres, behind a TLS-terminating proxy that
sets `x-forwarded-for`. Anything multi-instance would break rate limiting. (I)
