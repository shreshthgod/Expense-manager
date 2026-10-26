# Workflows (v2)

Each workflow lists where it starts, the API it calls, what the server guarantees, which cached views refresh afterwards and the tests that cover it.

**Refresh map:** after a successful write the client invalidates *views*, not individual queries, using `DEPENDENCIES` in `lib/client/query.tsx` (e.g. any transaction change refreshes dashboard, transactions, accounts, budgets, analytics, reports, insights, calendar, recurring, notifications, merchants, tags and the inbox). Other tabs of the same user are told through a `BroadcastChannel` and revalidate. Financial writes are never optimistic: the UI updates after the server commits.

Test legend: **U** unit, **I** integration (`tests/integration`), **E** Playwright (`e2e/`).

| ID | Workflow | Entry point | API | Guarantees | Tests |
|---|---|---|---|---|---|
| WF-01 | Register & sign in | `/register`, `/login` | `POST /api/auth/register`, `/login` | Server-side session row; httpOnly `__Host-` cookie in production; same error for unknown email and wrong password; IP + email rate limits; `next` redirects restricted to same-site paths. | I security, E core-journey |
| WF-02 | Onboarding | `/onboarding` | `GET/POST /api/onboarding` | One step at a time, each idempotent (refresh/retry never duplicates the account, budget or goal); resumable; categories are archived, never deleted. | I regressions (B11), E core-journey |
| WF-03 | Accounts | `/accounts`, `/accounts/[id]` | `/api/accounts`, `/api/accounts/[id]` | Opening balance + ledger; unique names per user; archive keeps history; delete only when unused; credit-card fields (last 4 digits only). | I ledger, planning (credit cards), E |
| WF-04 | Record expense / income / transfer | Add button, `Ctrl K`, mobile ➕ | `POST /api/transactions` | Validated with the same schema as the form; idempotency key; balance effects in the same DB transaction; future dates saved as PLANNED. | I ledger, domain, U contracts, E |
| WF-05 | Edit transaction | Transaction detail → Edit | `PATCH /api/transactions/[id]` | Version check (409 on stale edit); old effects reversed and new ones applied atomically; reconciled records need confirmation and reopen the reconciliation. | I ledger, import-reconcile |
| WF-06 | Delete & undo | Transaction detail → Delete | `DELETE /api/transactions/[id]`, `POST …/restore` | Soft delete reverses effects; Undo restores the row and effects; a purchase with refunds needs an explicit "delete refunds too". | I domain, E core-journey |
| WF-07 | Split a purchase | Form → "Split across categories" | `POST/PATCH /api/transactions` (`splits`) | Lines sum to the amount exactly; one account debit; each category counted once in budgets/analytics; can be turned back into a single category. | I domain (scenario D), U contracts |
| WF-08 | Refund | Detail → Record refund | `POST /api/transactions/[id]/refunds` | Linked to the purchase, can't exceed it, reduces net spending on its own date, credits the receiving account. | I domain (scenario A) |
| WF-09 | Search, filter, bulk edit, export | `/transactions` | `GET /api/transactions`, `POST /api/ai/parse-filter`, `POST /api/transactions/bulk`, `GET /api/export` | Filters live in the URL; smart filter is deterministic; bulk actions preview-able and bounded to 500; CSV export honours the same filters and is formula-injection safe. | I domain (bulk), U natural-filter |
| WF-10 | Categories | Settings → Categories | `/api/categories` | Per-user; renames relabel history; categories in use are deleted only with reassignment; defaults can only be archived. | I regressions |
| WF-11 | Merchants & rules | Settings → Merchants & rules | `/api/merchants`, `/api/rules` | Aliases group spellings; rules suggest or apply on save/import; "apply to past" previews and never overwrites existing categories. | I domain (rules) |
| WF-12 | Budgets | `/budgets` | `/api/budgets` | Overlap rule, pace, rollover, alerts once per cycle and threshold. | I regressions, planning (rollover), U budget |
| WF-13 | Budget templates | `/budgets` → Templates | `/api/budgets/templates`, `…/apply` | Dry-run plan (create / replace / skip); replace ends old budgets the day before. | I planning |
| WF-14 | Goals & contributions | `/goals` | `/api/goals`, `/api/goals/[id]/contributions` | Contribution ledger; earmark vs real transfer; can't go below zero; projections; over-allocation warning. | I planning, U goal, planning |
| WF-15 | Recurring items | `/recurring`, `/recurring/[id]` | `/api/recurring`, `…/state`, `…/occurrences/[date]` | One occurrence per date; nothing auto-recorded unless opted in; pause/resume/cancel; per-date override. | I recurring |
| WF-16 | Bills & subscriptions | `/bills`, `/subscriptions` | same engine, `…/settle` | Mark paid records exactly one transaction (idempotent); skip records nothing; reminders deduped. | I recurring |
| WF-17 | Calendar | `/calendar` | `GET /api/schedule`, `/api/analytics/heatmap` | Scheduled items de-duplicated per rule and date; actual spending per day. | I recurring |
| WF-18 | Statement import | `/import` → `/import/[id]` | `POST /api/import`, `…/confirm`, `…/undo` | Preview first; duplicates flagged; retry-safe confirm; undo. | I import-reconcile |
| WF-19 | Reconcile an account | Account → Reconcile | `/api/reconciliations`, `…/complete` | Compare as of statement date; zero difference or explicit adjustment; later changes reopen. | I import-reconcile |
| WF-20 | Receipts | Transaction detail → Attach | `POST /api/transactions/[id]/attachments`, `GET /api/attachments/[id]` | Type checked by file content (JPEG/PNG/WebP/PDF), 5 MB cap, owner-only download with `nosniff` and sandbox CSP. | I import-reconcile |
| WF-21 | Net worth & balance history | `/net-worth`, account page | `GET /api/net-worth`, `/api/accounts/[id]/history` | Rebuilt from the ledger at each date. | I planning |
| WF-22 | Cash flow, safe to spend, what-if | `/cash-flow`, dashboard | `/api/planning/*` | Documented formulas; each figure shows its working. | I planning |
| WF-23 | Analytics | `/analytics` | `/api/analytics/*` | Canonical definitions; split-aware; comparisons of like periods. | I domain |
| WF-24 | Monthly review | `/review`, inbox | `GET/POST /api/review` | Snapshot on review; flags later back-dated changes. | I planning |
| WF-25 | Reports | `/reports`, `/reports/[id]` | `/api/reports`, `…/export` | Dataset computed first and stored immutably; narrative grounded or templated; CSV/JSON export; print to PDF; stale badge when records change. | I smoke |
| WF-26 | Assistant | `/assistant` | `/api/ai/chat`, `/api/ai/conversations` | Read-only tools; conversations resume, pin, rename, delete; proposed actions need confirmation. | I regressions (B9), U intent |
| WF-27 | Settings, security, data | `/settings` | `/api/preferences`, `/api/profile`, `/api/auth/*`, `/api/backup*`, `/api/user` | Preferences apply everywhere immediately; password change signs out other sessions; session list with revoke; full backup/restore (dry run, merge/replace, one transaction, ledger verified); account deletion needs password + typed confirmation. | I security, planning (backup) |

## Cross-cutting behaviour

- **Review inbox** (`/inbox`, `GET /api/inbox`) derives its items live — uncategorised transactions, planned items past their date, due/failed bills, budgets over limit, goals behind, accounts to reconcile, imports waiting, the monthly review — so an item disappears as soon as its cause is fixed.
- **Notifications** are produced after commit by outbox handlers, deduplicated and gated by preferences; "mark read" never deletes.
- **Offline**: the shell shows a banner; nothing is written while offline; the service worker never caches API responses or pages (only build assets and the offline page).
- **Sign-out** clears the query cache in every tab and the service-worker cache.
