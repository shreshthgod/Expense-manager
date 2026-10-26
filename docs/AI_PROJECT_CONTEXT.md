# AI project context

A brief for an AI agent (or a new engineer) about to change this codebase. Read this, then `BUSINESS_LOGIC.md` for the rule you're touching.

## What this is

Expense Manager 2.0 — a multi-user personal-finance web app (Indian context by default: INR, Asia/Kolkata, lakh/crore formatting). Next.js 14 App Router, React 18, TypeScript strict, Prisma 5 + PostgreSQL 16, TanStack Query, Tailwind, Framer Motion, Recharts. Tests: Vitest (unit + integration against a real database) and Playwright.

## Non-negotiable rules

1. **Money correctness first.** Balances come only from `server/ledger/effects.ts`. Every mutation runs inside `runInTransaction` with row locks, applies effects in the same transaction and enqueues side effects to the outbox. After changing anything that touches money, integration tests must still end with `verifyLedger(userId) === []`.
2. **One definition per figure.** Income, net spending, surplus and savings rate come from `server/analytics/definitions.ts`; category figures from `allocations.ts` (split-aware). Don't re-derive them in pages or tools.
3. **Dates are calendar dates.** Use `lib/dates/date-only.ts` (`ISODate` strings). Never do `new Date()` arithmetic on financial dates; "today" is `todayFor(settings)`.
4. **Validation is shared.** Add or change fields in `lib/validation/schemas.ts`; forms build bodies in `lib/forms/*` and a contract test proves the body parses. Cleared optional fields are `null`.
5. **Routes are thin.** Wrap with `withAuth`/`withPublic`/`withCron`, parse with the shared schema, call one service. No Prisma in routes (a test enforces it). Scope every query by `userId`; foreign ids → 404.
6. **The AI never produces numbers.** Tools in `agents/tools.ts` are read-only and return computed data; narrations must pass `isGrounded` (`agents/grounding.ts`) or fall back to templates; proposed actions are executed only by the user through the normal API.
7. **No fake data in the UI.** Empty states explain what to do. Every figure that's derived offers an "How is this calculated?" (`Explain`) panel.
8. **Client writes aren't optimistic.** Use `useFinanceMutation({ affects: [...] })`; add new views to `DEPENDENCIES` in `lib/client/query.tsx` so they refresh.

## Where things are

| Need | Look at |
|---|---|
| A page | `app/(app)/<route>/page.tsx` (client components; server layout loads the session) |
| Shared UI | `components/ui/*` (primitives), `components/app/*` (Field, pickers, MoneyInput, StatTile, Segmented, Explain, states) |
| Data hooks | `lib/client/hooks.ts`, `lib/client/api.ts` |
| An endpoint | `app/api/**/route.ts` → `docs/API.md` |
| A rule | `server/services/*`, `server/analytics/*` → `docs/BUSINESS_LOGIC.md` |
| Scheduled work | `server/jobs/scheduler.ts` |
| Notifications | `server/events/handlers.ts` + `notify()` with a dedupe key |
| Schema changes | `prisma/schema.prisma` + a new SQL migration in `prisma/migrations/000N_*` (never `db push`) |
| Tests | `tests/unit`, `tests/integration` (helpers: `call`, `newActor`, `idem`), `e2e/` |

## Adding a feature — checklist

1. Schema + migration (with `CHECK`/`UNIQUE` constraints for invariants) if needed.
2. zod schema in `lib/validation/schemas.ts`.
3. Service function (transaction, ownership, version, audit, outbox event).
4. Route with the right wrapper; regenerate `docs/API.md` (`node scripts/gen-api-docs.mjs`).
5. Hook + page/component; form builder in `lib/forms` + contract test.
6. Integration test including a cross-user 404 and ledger verification.
7. Update `docs/BUSINESS_LOGIC.md` / `WORKFLOWS.md` / `FEATURES.md` if behaviour changed.
8. `npm run verify`; for UI changes also `npm run build && npm run test:e2e`.

## Commands

```bash
npm run dev                      # app
npm run test:unit                # fast
npm run test:integration         # needs TEST_DATABASE_URL (wiped)
npm run build && npm run test:e2e
npm run db:seed                  # demo@expensemanager.in / Demo@1234
npm run cron                     # scheduled work once
```

## Known sharp edges

- `next@14.2.35` has advisories fixed only in newer majors (see `SECURITY.md`).
- `style-src 'unsafe-inline'` is required by charts/motion; scripts need the CSP nonce (Next applies it automatically; custom inline scripts must use `headers().get("x-nonce")`).
- Sticky elements inside `overflow-hidden` containers stick to the container, not the page (see the transactions list).
- `next/font/google` needs network access at build time.
