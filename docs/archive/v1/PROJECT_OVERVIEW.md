# Project Overview

**Name:** `expense-manager` · **Version:** 1.0.0 · **Path:** `/home/makan/A-015`
**Type:** Single-user, self-hosted personal finance web application with an AI assistant layer.

---

## What it is

A Next.js 14 (App Router) + PostgreSQL application where a person can:

1. Register, log in, and complete a 5-step onboarding wizard.
2. Record income and expenses against accounts and categories.
3. Set monthly/weekly/yearly/custom budgets and savings goals.
4. Define recurring transactions that are materialised automatically.
5. See deterministic analytics: summaries, category breakdowns, trends, budget status,
   anomaly detection, spending forecast, affordability verdicts, and a weighted financial health score.
6. Chat with an AI agent that *explains* those computed numbers (it is never allowed to invent them).
7. Generate Monthly / Quarterly / Yearly reports.

Currency is **INR (₹)** and locale is **`en-IN`**, both hardcoded in `lib/utils/format.ts`.

---

## One-screen identity

| Item | Value |
|---|---|
| Frontend | Next.js 14 App Router, React 18, TypeScript 5.7, Tailwind 3.4 |
| Components | Custom shadcn-style primitives + Radix Slot/Label, CVA, lucide-react, framer-motion, Recharts |
| Backend | Next.js Route Handlers (`runtime = "nodejs"`), service layer in `server/` |
| Database | PostgreSQL via Prisma 5.22 (raw SQL for month bucketing) |
| Auth | JWT (`jose`, HS256) in an `httpOnly` cookie + bcryptjs(10) |
| Validation | zod 3.25 |
| Tests | Vitest 2.1 — 67 unit tests, all passing |
| Theming | next-themes (light / dark / system), CSS-variable tokens |

---

## Repo at a glance

```
app/         53 files / 5,222 lines   pages + 35 API route files (55 handlers)
server/      25 files / 2,445 lines   services + analytics (pure domain logic)
agents/      9 files / 1,331 lines    AI pipeline (intent → planner → tools → report)
components/  20 files / 1,496 lines   Shell + 18 UI primitives
lib/         13 files /   706 lines   auth, api helpers, validation, constants, utils
prisma/       2 files /   519 lines   schema.prisma, seed.ts
tests/        5 files /   565 lines   money, intent, validation, goal, budget
types/        2 files /   161 lines   api.ts, index.ts
```

---

## Quality gates (measured, 2026-09-27)

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx next lint` | ✅ 0 errors, 1 warning (`components/ui/avatar.tsx:74` `<img>`) |
| `npx vitest run` | ✅ 5 files / 67 tests passing (611 ms) |
| Database reachable | ❌ `localhost:5432` refused — no live runtime verification possible |
| Production build | ❌ `.next/BUILD_ID` absent (dev artefact only) |

---

## Running it

```bash
npm install
cp .env.example .env      # set DATABASE_URL, AUTH_SECRET, AI_*
npx prisma db push        # NOTE: prisma/migrations/ does not exist
npm run db:seed           # demo@expensemanager.in / Demo@123  ⚠ wipes all data
npm run dev
```

Scripts: `dev`, `build` (`prisma generate && next build`), `start`, `lint`, `typecheck`,
`test`, `test:watch`, `db:migrate`, `db:push`, `db:seed`, `db:studio`.

---

## Headline status

**Architecture is sound** (clean domain layer, consistent auth, parameterised SQL, deterministic
analytics), but **the forms and the API disagree about what a "category id" is**, so several core
flows fail at runtime despite a green typecheck:

- Add / Edit Transaction → 400 (category *name* sent where a `cuid` is required)
- Add Income → 400 (same)
- Create Budget with a category → 400; **Edit Budget → always 400**
- Create / Edit Goal → 400 unless category **and** "optional" description are both filled
- Notification "mark as read" → deletes the notification
- Accounts, Categories, Recurring, CSV Import, AI Insights have **full APIs but no UI at all**

See `docs/KNOWN_ISSUES.md` for reproductions and `docs/ROADMAP.md` for the fix order.

---

## Related documents

| File | Contents |
|---|---|
| `PROJECT_INTELLIGENCE.md` | The full 43-section reverse-engineering report |
| `ARCHITECTURE.md` | Layering, routing, auth, request flow |
| `FEATURES.md` | Feature inventory with working / broken / missing status |
| `WORKFLOWS.md` | Step-by-step user and system journeys |
| `DATABASE.md` | Schema, relations, enums, seed |
| `API.md` | Complete endpoint reference |
| `BUSINESS_LOGIC.md` | Formulas, thresholds, scoring |
| `SECURITY.md` | Threat model and findings |
| `KNOWN_ISSUES.md` | Bugs with evidence |
| `ROADMAP.md` | Prioritised next steps |
| `AI_PROJECT_CONTEXT.md` | Machine-readable master context + specification |
