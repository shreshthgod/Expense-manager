# Architecture (v2)

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Prisma 5 · PostgreSQL 16 · TanStack Query 5 · Tailwind · Framer Motion · Recharts · Vitest · Playwright.

```
Browser ──► middleware.ts (edge: session signature, CSP nonce, no-store)
   │
   ├─ app/(app)/**/page.tsx  client pages ──► lib/client/{api,query,hooks}.ts ──► /api/*
   │        (server layout: loads session + preferences, redirects if needed)
   │
   └─ app/api/**/route.ts  ── withAuth / withPublic / withCron (lib/api/route.ts)
            │                   auth, same-origin, error envelope, logging
            ▼
        lib/validation/schemas.ts  (zod, shared with the forms)
            ▼
        server/services/*  ── business rules, one DB transaction per mutation
            │   ├─ server/ledger/{effects,sql}.ts     balance effects (single source)
            │   ├─ server/analytics/*                 canonical read models (SQL)
            │   ├─ server/db/idempotency.ts            runInTransaction + idempotency
            │   └─ server/events/{outbox,handlers}.ts  side effects after commit
            ▼
        Prisma ──► PostgreSQL (migrations 0001–0005, CHECK + UNIQUE constraints)

Scheduler: server/jobs/scheduler.ts  ◄── /api/cron/run (CRON_SECRET) · npm run cron · /api/system/sync (throttled, per user)
AI:        agents/* (intent → planner → read-only tools → analysis → decision) · agents/grounding.ts
```

## Layers and rules

| Layer | Responsibility | Must not |
|---|---|---|
| `app/(app)` pages, `components/*` | Rendering, form state, calling the API through `lib/client/api.ts`; invalidate via `useFinanceMutation({ affects })` | Compute financial figures (only display them); import Prisma |
| `app/api` routes | Parse input with shared schemas, call one service, return the envelope | Access Prisma models directly (enforced by `route-guard` test) |
| `server/services` | Business rules, ownership checks, locking, audit, outbox events | Send notifications or call AI inside a transaction |
| `server/analytics` | Read-only aggregates using the canonical definitions and allocations | Write anything |
| `server/ledger` | The only definition of balance effects | — |
| `server/events` | Durable side effects (budget alerts, anomaly checks, goal milestones, report/import notifications) processed after commit with retry/backoff | Run inside the request's transaction |
| `agents` | Classify, pick tools, narrate computed figures | Write data; invent numbers (checked by `grounding.ts`) |

## Key mechanisms

- **Transactions and idempotency** — `runInTransaction(userId, idempotency, fn)` wraps a mutation; the idempotency record (key + request hash + response) is written in the same transaction, so a retry replays the stored response and a reused key with a different body is rejected.
- **Concurrency** — mutable records carry `version`; edits send the version they started from (409 on mismatch). Rows are locked with `SELECT … FOR UPDATE`; the scheduler claims work with `SKIP LOCKED`; unique constraints make duplicates impossible (occurrences per date, import rows, notification dedupe keys).
- **Outbox** — services enqueue `OutboxEvent` rows inside their transaction; `dispatchEvents` runs them right after commit and the scheduler retries failures with backoff. Handlers are idempotent.
- **Client cache** — query keys are `["u", userId, domain, …]`; `DEPENDENCIES` maps a mutation kind to every affected view; `BroadcastChannel` keeps tabs in sync; sign-out clears everything.
- **Sessions** — JWT carries a session id; `getCurrentUser()` checks the session row on every server request (revocation takes effect immediately); the edge middleware only checks the signature.
- **Dates** — financial dates are `DATE` columns handled as `YYYY-MM-DD` strings end to end (`lib/dates/date-only.ts`).

## Directory map

| Path | Contents |
|---|---|
| `app/(auth)` | Sign-in and registration |
| `app/(app)` | Authenticated pages (dashboard, inbox, calendar, transactions, income, accounts, bills, subscriptions, recurring, import, budgets, goals, net-worth, cash-flow, analytics, review, reports, assistant, notifications, settings) |
| `app/onboarding`, `app/offline`, `app/page.tsx` | Setup wizard, offline fallback, landing |
| `app/api` | 100 route files — see `docs/API.md` |
| `components/ui` | Primitives (button, dialog/sheet, tabs, toast, …) |
| `components/app` | Field, pickers, money input, states, stat tiles, segmented control, explain panel |
| `components/{transactions,accounts,recurring,settings,reports,charts,shell}` | Feature components |
| `lib/client` | API client, query cache/invalidation, hooks, form helpers |
| `lib/forms` | Form state ↔ request body builders (contract-tested) |
| `lib/validation` | zod primitives and schemas |
| `lib/finance`, `lib/dates`, `lib/import`, `lib/utils` | Pure domain helpers (recurrence, cycles, natural filters, CSV, money, formatting) |
| `server/*` | Services, analytics, ledger, events, jobs, db helpers |
| `agents/*` | Assistant pipeline and grounding |
| `prisma/` | Schema, migrations, demo seed |
| `tests/unit`, `tests/integration`, `e2e/` | Test suites (see `docs/TESTING.md`) |
