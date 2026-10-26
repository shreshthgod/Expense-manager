# Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit | `npm run test:unit` | Pure logic: dates and cycles, recurrence, money and formatting, validation schemas, form ↔ API contracts (every form's body parses with the server schema), budget rollover, goal projections, AI number grounding, natural-language filters, import parsing, intent classification, and a static guard that every API route is wrapped and never touches Prisma directly. |
| Integration | `npm run test:integration` | Real route handlers against a real PostgreSQL (`TEST_DATABASE_URL`, reset with `prisma migrate reset` before the run). Ledger invariants after every step, numeric scenarios A (connected lifecycle with a linked refund), B (credit-card purchase and repayment) and D (split purchase counted once per category), plus planned/versioned/idempotent writes and account rules, v1 regression cases B1–B18/S6, security (cross-user access, sessions, CSRF, rate limits, account deletion), recurring engine (idempotent settle, catch-up, pause/resume), import (duplicates, 2,000 rows, retry-safe confirm, undo), reconciliation (reopen on change), attachments, planning (rollover, goal ledger, templates, safe to spend, cash flow, emergency fund, what-if, net worth, credit-card statements, monthly review), backup round-trip and tamper rejection. |
| End-to-end | `npm run build && npm run test:e2e` | Playwright against the production build: register → onboarding → accounts → expense/income/transfer → balances and budget agree → delete + undo → sign out (desktop and a phone viewport); and a sweep of every page as the demo user failing on any runtime error, failed API call or CSP violation. |
| All | `npm run verify` | lint + typecheck + unit + integration + build |

## Local setup

```bash
cp .env.example .env            # set DATABASE_URL, TEST_DATABASE_URL, AUTH_SECRET
npx prisma migrate deploy
npm run db:seed                 # demo@expensemanager.in / Demo@1234 (needed by e2e/pages.spec.ts)
npm run test:all
npm run build && npx playwright install chromium && npm run test:e2e
```

`TEST_DATABASE_URL` must point at a disposable database — it is wiped before each integration run. Integration tests run in a single fork so they can share it.

## Writing tests

- Money flows: assert balances **and** `verifyLedger(userId)` returns `[]` at the end.
- New API routes: wrap with `withAuth`/`withPublic`/`withCron` (the guard test will tell you), and add a cross-user test (another user's id → 404).
- New forms: add a contract test that the form's body parses with the route's schema, including cleared optional fields.
- Dates: use `todayISO("Asia/Kolkata")` and date helpers, never `new Date()` arithmetic.
