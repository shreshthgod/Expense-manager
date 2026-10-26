# Features (v2.0.0)

Every item below is reachable from the UI and backed by the API. "Tests" refers to `docs/TESTING.md`.

| Area | Feature | Page | Notes |
|---|---|---|---|
| Account | Register, sign in, sign out, sessions list and revoke, password change, account deletion | `/register`, `/login`, Settings → Security | Server-side sessions |
| Setup | Resumable onboarding: currency, time zone, pay cycle, first account, categories, first budget, first goal | `/onboarding` | Each step idempotent |
| Dashboard | Money in − spent = kept for week/month/last month/year; net worth, cash, owed, subscriptions; safe to spend; coming up; 6-month trend; categories; budgets; goals; insight cards with "why"; recent transactions; inbox banner; customisable sections | `/dashboard` | Read-only request |
| Inbox | Uncategorised, planned-past-date, due/failed bills, over-budget, goals behind, reconcile reminders, pending imports, monthly review | `/inbox` | Derived live |
| Calendar | Month grid of scheduled items with status plus daily spending intensity | `/calendar` | |
| Transactions | Create/edit/duplicate/delete with undo; planned entries and posting; splits; refunds; receipts; tags; merchant; payment method; notes; URL filters; smart filter; bulk categorise/tag/move/delete; pagination; CSV export; "is this amount typical?" | `/transactions` | Version conflicts detected |
| Income | Income list, income by source, expected recurring income | `/income` | |
| Accounts | Assets and liabilities, opening balance and date, archive, delete when unused, balance history chart, adjust balance, reconcile with statement, reconciliation history, credit-card limit/utilisation/statement/due | `/accounts`, `/accounts/[id]` | |
| Bills & subscriptions | Monthly/annual cost, states (upcoming, due soon, due today, overdue, paid, paused, cancelled), mark paid, skip, pause/resume/cancel, per-date amount, history and upcoming dates | `/bills`, `/subscriptions`, `/recurring`, `/recurring/[id]` | Opt-in auto recording |
| Import | CSV statements, bank presets and saved mappings, live preview, per-row review, duplicate detection, transfer classification, retry-safe confirm, undo | `/import`, `/import/[id]` | Not a bank connection |
| Budgets | Weekly/monthly/yearly/custom, category or overall, pace and projection, rollover, templates, alerts | `/budgets` | |
| Goals | Savings, sinking funds (yearly repeat), emergency fund; earmark or transfer contributions; release; history; projections; archive | `/goals` | Contribution ledger |
| Net worth | Month-end history (6/12/24 months), assets vs liabilities, per-account table | `/net-worth` | From the ledger |
| Cash flow | Day-by-day forecast (30/45/90 days, with/without expected income), negative-cash warning, scheduled movements, safe to spend with its working, what-if simulator with optional explanation | `/cash-flow` | |
| Analytics | Period totals and pace, 12-month bars, essential/discretionary and fixed/variable, categories with change, top merchants, 6-month category trends, weekday profile | `/analytics` | Split-aware |
| Monthly review | Totals vs previous month, highlights, categories, budgets, bills, goals, merchants, unusual expenses, "explain this month", notes, snapshot | `/review` | Flags later changes |
| Reports | Monthly/quarterly/yearly, stored dataset, grounded narrative, CSV/JSON export, print to PDF, regenerate, stale badge | `/reports`, `/reports/[id]` | |
| Assistant | Conversations with history, pin/rename/delete, suggestions, figures used, proposed actions with confirmation, AI status | `/assistant` | Works without an AI key |
| Notifications | Bell, list, read/unread, delete, mark all read, preference per type | `/notifications`, Settings → Notifications | Deduplicated |
| Settings | Profile; currency, date format, time zone, week start, pay-cycle day, default account, emergency-fund target; categories (colour, essential/discretionary, fixed/variable, archive, delete with reassignment); rules; merchants; favourites; appearance (theme, motion); security; data (backup, restore, CSV exports, delete account) | `/settings` | |
| Everywhere | Command palette (`Ctrl K`) search and navigation, quick add, mobile bottom bar, offline banner, installable PWA, dark mode, reduced motion, skip link, focus management | — | |
