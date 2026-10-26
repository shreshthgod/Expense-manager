# Known issues (v2.0.0)

Three sections: how every issue from the v1 audit (`docs/archive/v1/KNOWN_ISSUES.md`, `SECURITY.md`) was resolved, bugs found and fixed during the v2 work, and what is still limited today.

## 1. v1 audit — resolution

| ID | v1 problem | v2 resolution | Evidence |
|---|---|---|---|
| B1 | Add/edit transaction always 400 (category name sent as id) | Pickers send database ids; forms validate with the server's own schema; per-user categories | I `regressions` B1, U `contracts` |
| B2 | Add income always 400 | Same model/schema; income categories only | I `regressions` B2 |
| B3 | Edit budget always 400 | Versioned PATCH built from the form contract | I `regressions` B3 |
| B4 | Create budget fails with a category | Nullable id fields handled explicitly | I `regressions` B4 |
| B5 | Goal needs category and description | Optional fields sent as explicit `null` | I `regressions` B5 |
| B6 | Cleared goal deadline became 1970-01-01 | Date-only fields; empty → `null` | I `regressions` B6, U `goal` |
| B7 | "Mark as read" deleted the notification | Separate read/unread PATCH and DELETE | I `regressions` B7 |
| B8 | Category filter ignored | Filter by id; invalid id is a visible 400 | I `regressions` B8 |
| B9 | Chat never resumed a conversation | Conversation id round-trips; history, pin, rename, delete | I `regressions` B9 |
| B10 | Editing a budget dropped its category | Form keeps the current category | U `contracts` |
| B11 | No way to create an account | Accounts pages + onboarding step (idempotent) | I `regressions` B11, E |
| B12 | Transfers moved no money | Double-entry effects on both accounts | I `ledger` |
| B13 | "Delete account" was a stub | Password + typed confirmation, real deletion, session killed | I `security` |
| B14 | Landing page showed fake statistics | Rewritten; the only figures are a labelled illustration | — |
| B15 | Currency/date format/notification settings inert | Applied everywhere immediately; currency locked once accounts exist | E pages |
| B16 | Duplicate "mark all read" routes | One route | U `route-guard` |
| B17 | Unvalidated pagination | Validated page/pageSize everywhere | U `validation` |
| B18 | Category names unique across all users | Per-user unique; migration 0002 copied system categories per user | I `regressions` B18 |
| B19 | Seed wiped every tenant | Seed touches only the demo user; refuses production without `ALLOW_DEMO_SEED=true` | — |
| B20 | Dead code/dependencies | Removed v1 pages, routes and unused components | — |
| S1 | Two sources of truth for categories | Database only | — |
| S2 | Two sources of truth for validation | `lib/validation/schemas.ts` shared by forms and routes | U `contracts` |
| S3 | No integration tests | 8 integration suites against a real PostgreSQL, Playwright E2E | `tests/`, `e2e/` |
| S4 | Silent client errors | Inline field errors, form-level errors, error states with retry | E `pages` |
| S5 | No scheduler | `server/jobs/scheduler.ts` (cron route, CLI, throttled sync) | I `recurring` |
| S6 | GET with side effects | Dashboard/insights are read-only; side effects run in the outbox | I `regressions` S6 |
| F1 | Hard-coded fallback `AUTH_SECRET` | Fails closed without a strong secret | U |
| F2 | Non-revocable 30-day JWT | Server-side sessions (list, revoke, revoke others, revoked on password change) | I `security` |
| F3 | Vulnerable dependencies | Next 14.2.35 (latest 14.x); image optimizer disabled | `npm audit` |
| F4 | Spoofable client IP for rate limits | `TRUSTED_PROXY_HOPS`-aware IP extraction | I `security` |
| F5 | In-memory rate limits only | Optional database store (`RATE_LIMIT_STORE=database`) for multi-instance deployments | — |
| F6 | Account deletion without re-auth | Password required | I `security` |
| F7 | Auth by convention | Mandatory `withAuth/withPublic/withCron` + static guard test | U `route-guard` |
| F8 | No security headers/CSP | Nonce-based CSP, HSTS (prod), nosniff, frame-ancestors none, COOP, Permissions-Policy | E `pages` (no CSP violations) |
| F9 | Seed destroyed the database | See B19 | — |
| F10 | Cross-tenant category constraint | See B18 | — |
| F11 | Unvalidated pagination | See B17 | — |
| F12 | Arbitrary `avatarUrl` | https-only URL validation | U `validation` |
| F13 | GET side effects | See S6 | — |
| F14 | No CSRF token | Same-origin check on every browser mutation + `SameSite=Lax` cookie | I `security` |
| F15 | Secrets on disk | `.env` ignored; logger redacts secrets, tokens, cookies, authorization | U |
| F16 | Missing hardening | Request size limits, idempotency, row locks, DB `CHECK` constraints | I |

## 2. Found and fixed during v2

| Problem | Fix |
|---|---|
| `npm run db:seed` crashed (`bcrypt2.hash is not a function`) | Seed rewritten |
| CSV export with `?type=transactions` failed validation because `type` was also the transaction-type filter | Export takes the transaction type as `transactionType` |
| Editing any split transaction was blocked client-side (no single category) | Split editor in the form; split ↔ single conversion; contract tests |
| Adding an account from `/accounts?new=1` didn't open the new account (URL clean-up raced the navigation) | Clean-up skipped after a successful save (caught by E2E) |
| Sticky date headers covered transaction rows (they stuck inside an `overflow-hidden` card) | Card no longer clips; rows have scroll margin (caught by E2E) |
| Money shown with one decimal (₹1,176.3) | Paise always shown as two digits; unit test |
| Stat tiles truncated large amounts (₹4,54,86…) | Tiles wrap; grids collapse to two columns |
| Report page exported a helper component (invalid Next.js page export) | Moved to `components/reports` |

## 3. Current limitations

| Area | Limitation | Workaround / note |
|---|---|---|
| Accounts | Password reset by email isn't available (no mail service configured). | An administrator can reset a password hash in the database; see README. |
| Currency | One base currency per user; no conversion. Currency is locked once accounts exist. | Track foreign accounts in base-currency terms. |
| Import | CSV only (no PDF/OFX), 5,000 rows per file, no live bank connection. | Split large statements by date. |
| Attachments | Stored in PostgreSQL (`AttachmentBlob`), 5 MB each, 10 per transaction; not included in JSON backups. | Use a database-level backup to keep receipts. |
| Backup | Excludes sessions, notifications, audit log, AI conversations, import and reconciliation history. Restoring reconciliation marks isn't supported. | Reconcile again after a restore. |
| Forecast | Cash flow projects only scheduled and planned items, not everyday spending. | Stated on the page. |
| Emergency fund | Essential spending depends on categories being classified Essential. | Falls back to all spending and says so. |
| AI | Optional. Without `AI_API_KEY` the assistant and narratives use deterministic templates. AI answers containing any figure not in the data are discarded. | — |
| Rate limits | Default store is in-memory (per instance). | Set `RATE_LIMIT_STORE=database` behind a load balancer. |
| CSP | `style-src 'unsafe-inline'` is required by chart and motion libraries (scripts are nonce-only). | — |
| Build | `next/font/google` downloads IBM Plex Sans at build time (network needed during `next build`). | Self-host the font files if building offline. |
| Scheduler | Needs an external trigger in production (cron hitting `/api/cron/run` with `CRON_SECRET`, or `npm run cron`). The app also catches up on load. | See README → Deployment. |
| Snapshots | Health-score history starts from the first captured snapshot; earlier months have none. | — |
| Framework | `next@14.2.35` has open advisories fixed only in Next 15/16 (see `SECURITY.md` → Residual risks). Mitigations are in place; an upgrade is recommended as a separate change. | — |
| Tests | Numeric acceptance scenarios C and E from the specification aren't separate named tests; their behaviours (budget effects of refunds and recurring bills) are covered inside other suites. | Add named scenario tests if the spec text is needed verbatim. |
