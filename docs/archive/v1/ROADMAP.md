# Roadmap

Prioritised sequence of work derived from `KNOWN_ISSUES.md` and `SECURITY.md`.
Nothing here has been implemented — this is a plan only.

**Ground rules for whoever executes this**
1. Do not refactor while fixing; make the smallest correct change, then verify.
2. Every fix must land with a test that fails before the fix and passes after.
3. Never change an API contract and a page in separate commits — they must move together.
4. Run `npm run typecheck && npm run lint && npm test` after every change.

---

## Phase 0 — Unblock (before any feature work)

| # | Task | Why | Issue |
|---|---|---|---|
| 0.1 | Start PostgreSQL and confirm `prisma db push` + `npm run db:seed` succeed | nothing can be verified otherwise | env |
| 0.2 | Create an initial migration (`prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`) and commit `prisma/migrations/` | no reproducible baseline exists | DATABASE §7 |
| 0.3 | Fail closed when `AUTH_SECRET` is missing in production | F1 — total account takeover | SECURITY F1 |
| 0.4 | `prisma/seed.ts`: scope deletes to the demo user, fix the wrong `type` on income categories, drop the unused `PASSWORD` const | B19 | |
| 0.5 | Record a green baseline: `typecheck` ✅ `lint` ✅ `67 tests` ✅ | guard against regressions | |

---

## Phase 1 — Make the core loops work (Critical)

These four make the app usable at all. They share one root cause (S1: constants vs DB categories),
so fix them **together**.

### 1.1 Decide the category contract — **the pivotal decision**
Pick one and apply it everywhere:

| Option | Change set | Pros | Cons |
|---|---|---|---|
| **A. UI sends ids** (recommended) | add `GET /api/categories` usage to `transactions`, `income`, `budgets` dialogs; map constants → DB rows on first login (call the existing `ensureSystemCategories()`); dropdown `value = id` | keeps `cuid` contract, unlocks budgets/transactions relations | requires system categories to exist for every user |
| B. API accepts names | relax `transactionCreateSchema`/`budgetCreateSchema`/query to allow a name, resolve server-side | smallest UI change | loses referential integrity, name collisions, still need ids for analytics |

Recommendation: **Option A**, plus calling `ensureSystemCategories()` during registration/onboarding.

### 1.2 Fix the payloads

| ID | Fix | Files |
|---|---|---|
| B1 | send DB `categoryId` in add/edit transaction | `app/(app)/transactions/page.tsx` |
| B2 | same for income | `app/(app)/income/page.tsx` |
| B8 | same for the filter; surface `!res.success` as an error toast instead of silence | `app/(app)/transactions/page.tsx` |
| B4 | same for budget create | `app/(app)/budgets/page.tsx` |
| B3 | add `.or(z.literal(null))` **or** send a real id | `app/api/budgets/[id]/route.ts` |
| B10 | `openEdit` → `setFormCategoryId(b.categoryId ?? "")` | `app/(app)/budgets/page.tsx` |
| B5/B6 | align null handling: use `.nullable()` on the inline goal PATCH schema and on `goalCreateSchema.category/description`, **or** strip `null` client-side | `app/api/goals/[id]/route.ts`, `lib/validation/schemas.ts`, `app/(app)/goals/page.tsx` |

### 1.3 Notifications
| ID | Fix | Files |
|---|---|---|
| B7 | add `PATCH /api/notifications/[id]` → the already-written `markNotificationRead`; repoint both UI call sites | `app/api/notifications/[id]/route.ts`, `notifications/page.tsx`, `components/shell.tsx` |
| B16 | delete `POST /api/notifications/read-all` **or** document it as an alias | `app/api/notifications/read-all/route.ts` |
| B17 | validate `page`/`pageSize` with zod | `app/api/notifications/route.ts` |

### 1.4 Accounts
| ID | Fix |
|---|---|
| B11 | Build an Accounts page (list + create + edit + archive + delete) wired to the existing 4 endpoints, add it to the shell nav; **and** send `payload.account` from onboarding |
| B12 | Decide: implement real `TRANSFER` semantics (debit source, credit destination) **or** remove `TRANSFER` from the UI/type enum |

**Exit criteria for Phase 1:** a new user can register → onboard (with an account) → add a
transaction → see the balance change → create/edit a budget and a goal → read and *read-mark* a
notification, all without a 4xx toast.

---

## Phase 2 — Make the AI layer coherent (High)

| # | Task | Issue |
|---|---|---|
| 2.1 | Return `conversationId` from `runAgentChat`, keep it in page state, send it back; add a conversation list | B9 |
| 2.2 | Verify behaviour when `AI_API_KEY` is absent → graceful degradation, not a 500 | UNKNOWN |
| 2.3 | Either wire up `GET /api/ai/insights` and `POST /api/ai/analyze` to the UI (dashboard insight card + "can I afford this?" widget) **or** delete them | dead endpoints |
| 2.4 | Show `GET /api/ai/reports/[id]` in the reports page (currently only list + delete) | |
| 2.5 | Dedupe `REPORT_GENERATED` notifications (add a key) or accept duplicates | |

---

## Phase 3 — Make the backend trustworthy (High)

| # | Task | Issue |
|---|---|---|
| 3.1 | Session revocation: `tokenVersion` on `User` (or a `Session` table), checked in `verifySessionToken`; bump on password change and logout | SECURITY F2 |
| 3.2 | `DELETE /api/account`: require `{ password }`, write `ACCOUNT_DELETED` audit, `clearSessionCookie()`, wire the Settings button | B13 + F6 |
| 3.3 | Central guard so a future handler cannot forget `requireUserId` — e.g. `withAuth(handler)` wrapper, plus a static test that greps `app/api/**/route.ts` | F7 |
| 3.4 | Verify ownership of `categoryId`/`accountId`/`recurringTransactionId` on insert (`findFirst({id, userId})`) | §5 residual risk |
| 3.5 | Rate limiting: derive the client IP from a single trusted hop; move buckets to Redis if multi-instance | F4/F5 |
| 3.6 | Security headers in `next.config.mjs` | F8 |
| 3.7 | `Category` uniqueness → `@@unique([userId, name, isSystem])` + a migration | B18 |
| 3.8 | Dependency upgrade for `next` (14.2.35 advisories) and re-run `npm audit` | F3 |

---

## Phase 4 — Close the feature gaps that the API already supports (Medium)

Order is by user value:

1. **Recurring transactions UI** — CRUD page (engine already works; it just needs to run on a
   schedule — see 4.5).
2. **CSV import UI** — `csvPreviewSchema` already exists but no route consumes it; build
   preview → confirm → `POST /api/transactions/import`.
3. **Categories UI** — list/create/edit/delete (conflict + "used by N transactions" guards exist).
4. **Budget export** — link `GET /api/export?type=budgets`.
5. **Move housekeeping off `GET /api/dashboard`** — `POST /api/system/tick` + cron/systemd timer;
   fixes S5/S6.
6. **Preference plumbing** — make `currency`, `dateFormat` and the four `notify*` flags actually
   drive `lib/utils/format.ts` and the notification producers (or delete the fields).
7. **Use `Profile.monthlyIncome`** — as the savings-rate baseline for users with thin history, or
   remove it.
8. **Transaction filters the schema already supports** — account, merchant, min/max amount.
9. **Empty states** — use `hasAnyData` on the dashboard.

---

## Phase 5 — Quality system (Medium)

| # | Task |
|---|---|
| 5.1 | **API integration tests** with a test database (vitest + `prisma` + `next/experimental` or route-handler invocation). Minimum set: one happy-path and one 4xx test for each of the 20 mutating handlers — this alone would have caught B1–B6. |
| 5.2 | **Contract test**: for each page, assert the exact JSON body it sends parses against the schema it is sent to. |
| 5.3 | **Auth coverage test**: static assertion that every `app/api/**/route.ts` contains `requireUserId`. |
| 5.4 | Consolidate inline route schemas back into `lib/validation/schemas.ts` (S2), or at minimum add `.nullable()` to every field the UI can send as `null`. |
| 5.5 | Client-side `fetch` wrapper that: detects 401 → redirect to `/login?next=…`, surfaces field-level `details` next to inputs, and distinguishes network errors. |
| 5.6 | E2E smoke (Playwright) covering: register → onboard → add transaction → add budget → add goal → notifications. |
| 5.7 | CI pipeline running typecheck + lint + unit + integration on every push. |
| 5.8 | Coverage thresholds on `server/**` and `lib/**`. |

---

## Phase 6 — Code hygiene (Low, batch)

- Remove dead files: `app/(marketing)/layout.tsx`, `components/ui/textarea.tsx`,
  `components/ui/tooltip.tsx`.
- Remove `date-fns` from dependencies.
- Remove unused constants: `BUDGET_ALERT_THRESHOLDS`, unused `AuditAction` /
  `ReportType` / `NotificationType` members (or implement them).
- Delete the dead `void budgetStatuses` block in `forecast.ts` and the empty `if` in
  `health-score.ts`.
- Fix `avatar.tsx` `<img>` → `next/image` (resolves the only lint warning).
- Clamp `progress.tsx` to `0..100`.
- Reconcile the seed's category `type`/`icon`/`color` with `lib/constants`.
- Document the demo credentials in one place (README says `Demo@123`; the unused seed const says
  `Demo@1234`).

---

## Phase 7 — Product expansion (optional, after the above)

Bank statement ingestion (OFX/QIF) · receipt OCR · multi-currency with live rates ·
shared/household budgets with roles · budget rollover · split transactions · tags UI ·
cash-flow calendar · goal ↔ account linking · email/PWA notification delivery ·
password reset + email verification · PWA/offline · i18n.

---

## Suggested sequencing (single developer, approximate)

```
Week 1   Phase 0 + 1.1–1.3      → core CRUD works end to end
Week 2   Phase 1.4 + 3.1–3.3    → accounts UI + session revocation + auth guard rail
Week 3   Phase 5.1–5.3          → integration tests lock the contract
Week 4   Phase 2                → AI conversation continuity + wire dead endpoints
Week 5   Phase 3.4–3.8          → security hardening + dependency upgrade
Week 6   Phase 4.1–4.5          → recurring UI, CSV import, scheduler
Week 7+  Phase 4.6–4.9 + 6      → preferences, filters, empty states, hygiene
```

Phase 5 starting *before* Phase 2–4 is deliberate: without integration tests the same class of
UI/API drift that caused B1–B8 will reappear with every new feature.
