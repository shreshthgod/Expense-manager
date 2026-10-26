# Expense Manager

A personal ledger for money in India and beyond: accounts, transactions, bills, subscriptions, budgets, goals, cash-flow planning, statement import, reports and an assistant. Every figure is calculated from your own records; the optional AI only puts computed numbers into words.

**Version 2.0.0** · Next.js 14 · React 18 · TypeScript · PostgreSQL 16 · Prisma 5

## What it does

- **Accounts** — bank, savings, cash, wallets, investments, credit cards (limit, statement, amount due), loans. Balances = opening balance + posted entries; adjust or reconcile against statements.
- **Transactions** — expenses, income, transfers, refunds linked to purchases, splits across categories, planned (future) entries, receipts, tags, merchants, rules, favourites, bulk edits, undo, CSV export, smart filters ("food above 1000 last month").
- **Bills, subscriptions and recurring items** — reminders, mark paid / skip / change one date, optional automatic recording, calendar.
- **Budgets** — weekly/monthly/yearly/custom, per category or overall, pace, rollover, templates, alerts at 50/75/90/100 %.
- **Goals** — savings goals, sinking funds, emergency fund; contributions as earmarks or real transfers; projected completion.
- **Planning** — net worth history, cash-flow forecast, safe to spend (with its working shown), emergency cushion, what-if scenarios.
- **Insights** — analytics (essential vs discretionary, fixed vs variable, trends, merchants, weekdays), monthly review with snapshots, printable reports, review inbox, notifications.
- **Assistant** — questions in plain words, answered from computed data; proposes actions you confirm.
- **Data** — CSV statement import with duplicate detection and undo, full JSON backup and restore, account deletion.
- Installable (PWA), dark mode, reduced-motion support, keyboard and screen-reader friendly.

## Quick start

Requirements: Node.js 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env              # set DATABASE_URL and AUTH_SECRET (see below)
npx prisma migrate deploy
npm run db:seed                   # optional demo data
npm run dev                       # http://localhost:3000
```

Demo account after seeding: `demo@expensemanager.in` / `Demo@1234`.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | ≥ 32 random characters for signing sessions (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `CRON_SECRET` | production | Bearer token for `POST /api/cron/run` |
| `TRUSTED_PROXY_HOPS` | behind a proxy | Number of proxies in front of the app (for real client IPs) |
| `RATE_LIMIT_STORE` | multi-instance | `database` to share rate limits between instances |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` | no | Any OpenAI-compatible provider. Without them the assistant uses deterministic answers. |
| `TEST_DATABASE_URL` | tests | Disposable database for integration tests (wiped each run) |
| `ALLOW_DEMO_SEED` | no | Must be `true` to run the demo seed with `NODE_ENV=production` |

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm run lint`, `npm run typecheck` | Static checks |
| `npm test` | Unit tests |
| `npm run test:integration` | API + database tests (needs `TEST_DATABASE_URL`) |
| `npm run test:e2e` | Playwright against a production build |
| `npm run verify` | lint + typecheck + all tests + build |
| `npm run cron` | Run scheduled work once (due bills, recurring entries, reminders, snapshots, clean-up) |
| `npm run db:seed` | Demo data for the demo user only |
| `node scripts/gen-api-docs.mjs` | Regenerate `docs/API.md` |

## Deployment

1. `npm ci && npx prisma migrate deploy && npm run build && npm start` behind HTTPS.
2. Schedule `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/run` every 15 minutes (the app also catches up when a user opens it).
3. Back up PostgreSQL; receipts are stored in the database.

**Upgrading from v1:** back up first. On a v1 database created with `prisma db push`, mark the baseline as applied, then deploy: `npx prisma migrate resolve --applied 0001_baseline && npx prisma migrate deploy`. Migration 0002 converts shared categories to per-user copies, derives opening balances and converts dates; check `docs/DATABASE.md`.

**Password resets:** email isn't configured. An administrator can set a new bcrypt hash: `node -e "console.log(require('bcryptjs').hashSync('NewPassw0rd', 10))"` then `UPDATE "User" SET "passwordHash" = '<hash>' WHERE email = '<email>';` and ask the user to sign out other sessions from Settings → Security.

## Documentation

| Doc | Contents |
|---|---|
| [docs/FEATURES.md](docs/FEATURES.md) | Feature inventory and where each lives |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | WF-01…WF-27: entry points, APIs, guarantees, tests |
| [docs/BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md) | Every financial definition and formula |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, transactions, outbox, caching |
| [docs/DATABASE.md](docs/DATABASE.md) | Models, migrations, invariants |
| [docs/API.md](docs/API.md) | All endpoints (generated) |
| [docs/SECURITY.md](docs/SECURITY.md) | Controls and residual risks |
| [docs/MOTION_SYSTEM.md](docs/MOTION_SYSTEM.md) | Motion tokens and rules |
| [docs/TESTING.md](docs/TESTING.md) | Test suites and how to run them |
| [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) | v1 issue resolutions and current limitations |
| [docs/AI_PROJECT_CONTEXT.md](docs/AI_PROJECT_CONTEXT.md) | Brief for AI agents working on the code |
| [CHANGELOG.md](CHANGELOG.md) | What changed in 2.0.0 |

The v1 audit documents are kept in `docs/archive/v1/`.
# Expense-manager
