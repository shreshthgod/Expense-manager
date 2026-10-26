# Known Issues

Confidence markers: **CONFIRMED** = verified by reading the exact source *and/or* executing the
project's own `zod@3.25.76`; **INFERRED** = strongly implied but not executed; **UNKNOWN** =
insufficient evidence.

> All zod reproductions were run with `/tmp/opencode/zb.mjs` against
> `node_modules/zod` in this repo. Nothing in the project was modified.

---

## Severity summary

| ID | Severity | Area | Title |
|---|---|---|---|
| B1 | 🔴 Critical | Transactions | Add/Edit Transaction always returns 400 |
| B2 | 🔴 Critical | Income | Add Income always returns 400 |
| B3 | 🔴 Critical | Budgets | Edit Budget always returns 400 |
| B4 | 🟠 High | Budgets | Create Budget fails when a category is chosen |
| B5 | 🟠 High | Goals | Create Goal fails unless category **and** description are filled |
| B6 | 🟠 High | Goals | Edit Goal fails; cleared deadline becomes 1970-01-01 |
| B7 | 🟠 High | Notifications | "Mark as read" deletes the notification |
| B8 | 🟡 Medium | Transactions | Category filter is silently ignored |
| B9 | 🟡 Medium | AI | Chat never resumes a conversation |
| B10 | 🟡 Medium | Budgets | Edit silently drops the budget's category |
| B11 | 🟡 Medium | Accounts | No UI to create an account → Total Balance stuck at ₹0 |
| B12 | 🟡 Medium | Accounts | TRANSFER transactions move no money |
| B13 | 🟢 Low | Settings | "Delete Account" button is a stub |
| B14 | 🟢 Low | Landing | `/` shows hardcoded fake statistics |
| B15 | 🟢 Low | Prefs | Currency / date format / notify toggles are inert |
| B16 | 🟢 Low | API | Duplicate "mark all read" routes |
| B17 | 🟢 Low | API | `page`/`pageSize` unvalidated on notifications |
| B18 | 🟢 Low | DB | `Category @@unique([name, isSystem])` is global, not per-user |
| B19 | 🟢 Low | DB | Seed wipes every tenant |
| B20 | 🟢 Low | Quality | Dead code / dead dependencies / dead route group |

---

## B1 🔴 Add / Edit Transaction always 400 — **CONFIRMED**

**Where:** `app/(app)/transactions/page.tsx:162` + `:451-455` · `lib/validation/schemas.ts`

The dialog's category `<Select>` options are built from the *constants*:

```tsx
// transactions/page.tsx:451
{filteredCategories.map((c) => (
  <option key={c.name} value={c.name}>{c.name}</option>   // value = "Food", not a cuid
))}
```

and the submit handler sends that value as `categoryId`:

```tsx
// transactions/page.tsx:162
categoryId: formCategoryId || undefined,
```

`transactionBase.categoryId` is `z.string().cuid(...).optional().or(z.literal(null))` and
`transactionCreateSchema` adds `.refine(v => v.categoryId != null, …)`.

**Reproduction (executed):**
```
TX CREATE categoryId="Food"                 => FAIL  categoryId Category is required
TX CREATE categoryId="clx1234567890abcdefghijkl" => OK
```

**Effect:** every *Add Transaction* and *Edit Transaction* from the UI returns
`400 VALIDATION_ERROR` → toast → nothing is saved. **The app cannot record a transaction
through its own UI.**
Note `accountId` *is* a real cuid (fetched from `/api/accounts`), so only the category field is
wrong — which is exactly why the error message says "Category is required".

**Fix direction:** make the dropdown value the DB category id (fetch `/api/categories`), **or**
change the API contract to accept a category *name* and resolve it server-side (the constants are
the real source of truth for the UI today).

---

## B2 🔴 Add Income always 400 — **CONFIRMED**

**Where:** `app/(app)/income/page.tsx:112` and `:257-258`

```tsx
{INCOME_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
…
categoryId: formCategoryId || undefined,
```

Identical to B1. `POST /api/income` forces `type: "INCOME"` but still validates `categoryId` as a
cuid → 400.

**Fix direction:** same as B1.

---

## B3 🔴 Edit Budget always 400 — **CONFIRMED**

**Where:** `app/(app)/budgets/page.tsx:91` and `:77` · `app/api/budgets/[id]/route.ts:8-15`

The page always sends a `categoryId`, coerced to `null` when empty:

```tsx
// budgets/page.tsx:91
categoryId: formCategoryId || null,
```

The **route defines its own inline schema** (it does *not* use `budgetCreateSchema`):

```ts
// app/api/budgets/[id]/route.ts:8
const budgetUpdateSchema = z.object({
  …,
  categoryId: z.string().cuid().optional(),   // ← no .or(z.literal(null))
});
```

**Reproduction (executed):**
```
budget CREATE categoryId=null => OK
(but the PATCH schema is strictly narrower — categoryId: null → "Invalid input")
```

**Effect:** `PATCH /api/budgets/[id]` rejects `null`, and the page always sends `null` because
`openEdit` resets the field (see B10). **Every budget edit fails**, regardless of user input.

**Fix direction:** add `.or(z.literal(null))` to the inline schema, and stop resetting
`formCategoryId` in `openEdit`.

---

## B4 🟠 Create Budget fails when a category is chosen — **CONFIRMED**

**Where:** `app/(app)/budgets/page.tsx:91`, `:244`

```tsx
{EXPENSE_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
```

**Reproduction (executed):**
```
budget CREATE categoryId="Food" => FAIL  categoryId Invalid cuid
budget CREATE categoryId=null   => OK
```

**Effect:** creating a budget works **only** if the user leaves "All Categories" selected.
Any category-scoped budget (the primary use case) returns 400.

---

## B5 🟠 Create Goal fails unless category **and** description are filled — **CONFIRMED**

**Where:** `app/(app)/goals/page.tsx:121-147` · `lib/validation/schemas.ts::goalCreateSchema`

```tsx
const body = {
  name: formName,
  targetAmount: parseFloat(formTarget),
  deadline:   formDeadline   || null,
  category:   formCategory   || null,   // ← null when untouched
  description: formDescription || null, // ← null when untouched (field is labelled "Optional")
};
```

`goalCreateSchema.category` / `.description` are `optionalTrimmed(60/500)` =
`z.string().trim().max(n).optional().or(z.literal("").transform(() => undefined))` — an **empty
string** is fine, but **`null` is not**.

**Reproduction (executed):**
```
goal CREATE nulls      => FAIL  category Invalid input
goal CREATE cat filled => OK    {"name":"Emergency Fund","targetAmount":5000,"category":"Other","description":"x"}
```

**Effect:** "Create Goal" returns 400 unless the user picks a category **and** types a
description — even though the description input is explicitly labelled *Optional*.

---

## B6 🟠 Edit Goal fails; cleared deadline becomes 1970-01-01 — **CONFIRMED**

**Where:** `app/(app)/goals/page.tsx:128-130` · `app/api/goals/[id]/route.ts:8-16`

The **PATCH route uses its own inline schema**, not `goalUpdateSchema` from `lib/validation`:

```ts
const goalUpdateSchema = z.object({
  …,
  deadline:  z.coerce.date().optional(),        // ← no .or(z.literal(null))
  category:  z.string().trim().max(60).optional(),   // ← rejects null
  description: z.string().trim().max(500).optional(),// ← rejects null
  addContribution: z.coerce.number().positive().optional(),
});
```

**Reproduction (executed, against the *lib* schema which shares the same shape):**
```
goal UPDATE deadline null => OK {"deadline":"1970-01-01T00:00:00.000Z"}   ← silent corruption
goal UPDATE category null => FAIL  category Invalid input
goal UPDATE all form body => FAIL  category Invalid input
```

**Effect, two ways:**
1. As sent today (`category: null`, `description: null`) → **400**, edit never applies.
2. If those two were non-empty but the user cleared the date field → the edit "succeeds" and
   `deadline` is written as **1970-01-01**, so the goal immediately renders *Overdue*
   (`mapGoal` computes `daysRemaining` ≈ −20,000).

**Why `null` becomes 1970:** `z.coerce.date()` evaluates `new Date(null)` → epoch, which is a
*valid* `Date`, so the union/optional short-circuits before `z.literal(null)` could match.

**Extra:** the seeded goals have `category` set but **no `description`**, so they hit case 1 and
can never be edited from the UI.

**Fix direction:** use `.nullable()` explicitly (e.g. `z.date().nullable().optional()`), or
strip `null` keys client-side before sending.

---

## B7 🟠 Notification "Mark as read" deletes the notification — **CONFIRMED**

**Where:** `app/(app)/notifications/page.tsx`, `components/shell.tsx` (bell dropdown)

Both call:
```ts
fetch(`/api/notifications/${id}`, { method: "DELETE" })
```

**Server side:** `app/api/notifications/[id]/route.ts` implements **only** `DELETE`, which calls
`deleteNotification()` → `prisma.notification.deleteMany(...)`.

Meanwhile `notification.service.ts` **does** export a correct
`markNotificationRead(userId, id)` (`updateMany → read: true`) — but **grep shows it is imported
by zero routes**.

There is also no `PATCH /api/notifications/[id]`.

**Effect:** users permanently lose their notification history when they acknowledge it. Unread
count still decrements, so the bug looks like success.

**Fix direction:** add `PATCH /api/notifications/[id]` wired to the existing
`markNotificationRead`, and point both UI call sites at it.

---

## B8 🟡 Transactions category filter is silently ignored — **CONFIRMED**

**Where:** `app/(app)/transactions/page.tsx:95` + `:266-273`

```tsx
if (categoryFilter) params.set("categoryId", categoryFilter);   // categoryFilter = "Food"
…
fetch(`/api/transactions?${params}`)
  .then(r => r.json())
  .then(res => { if (res.success && res.data) setData(res.data); })   // 400 → ignored
```

**Reproduction (executed):**
```
TX QUERY categoryId="Food" => FAIL  categoryId Invalid cuid
```

**Effect:** selecting a category in the filter yields `400 VALIDATION_ERROR`, which the `.then`
silently drops — the list simply does not change and **no error is shown**. The user concludes
"filtering does nothing".

Related: `accountId`, `merchant`, `minAmount`, `maxAmount` are supported by
`transactionQuerySchema` but **never populated by the page**, so those filters don't exist in the UI.

---

## B9 🟡 AI chat never resumes a conversation — **CONFIRMED**

**Where:** `app/(app)/ai/page.tsx` · `lib/validation/schemas.ts::aiChatSchema`
(`conversationId?: cuid`) · `agents/agent-runner.ts` (accepts it)

Grep of the AI page shows **no `conversationId` in any request body, state variable, or response
handler.**

**Effect:**
- Every message creates a **new `AIConversation` row** plus its `AIMessage`s → table growth
  proportional to messages.
- The model receives **no prior context**, so multi-turn questions restart from zero.
- There is no conversation list UI, so the orphaned conversations are invisible.

**Fix direction:** return `conversationId` from `runAgentChat`, store it in page state, and send it
back on subsequent messages; add a conversation picker.

---

## B10 🟡 Edit Budget silently drops the category — **CONFIRMED**

**Where:** `app/(app)/budgets/page.tsx:72-84`

```tsx
const openEdit = (b: Budget) => {
  …
  setFormCategoryId("");   // ← should be b.categoryId (or the category name)
  setDialogOpen(true);
};
```

Even after B3 is fixed, opening the edit dialog blanks the category, so saving would clear it.
The `Budget` type on the page also doesn't appear to carry `categoryId` (the list DTO carries
`categoryId`/`categoryName`/`categoryColor` from `getBudgetStatuses` — verify before wiring).

---

## B11 🟡 No UI to create an account → Total Balance stuck at ₹0 — **CONFIRMED**

**Evidence:**
- `app/(app)/` contains **no** `accounts/` page; there is no nav entry for accounts.
- `app/api/accounts/*` (4 handlers) and `PATCH/DELETE /api/accounts/[id]` have **zero callers**
  in `app/` (grep) apart from `GET /api/accounts` used to populate the transaction form's
  account dropdown.
- `app/onboarding/page.tsx` never sets `payload.account`, although
  `onboardingSchema.account` supports `{name, type, balance, currency}`.
- `getTotalBalance()` = `Σ Account.balance` over the user's accounts.

**Effect:** a freshly registered user has **0 accounts**.
- "Total Balance" on the dashboard is permanently ₹0.
- The Add-Transaction account dropdown is empty (it is optional, so transactions still fail first
  for the B1 reason — but once B1 is fixed, every transaction would be account-less, so balances
  would never move).
- Seed data is the *only* way accounts come into existence.

**Fix direction:** add an Accounts page (list/create/edit/archive/delete) and/or send the first
account from onboarding.

---

## B12 🟡 TRANSFER transactions move no money — **CONFIRMED**

**Where:** `server/services/transaction.service.ts:104-109`

```ts
function balanceDelta(type, amount) {
  if (type === "EXPENSE") return -amount;
  if (type === "INCOME")  return  amount;
  return 0; // TRANSFER between own accounts not double-counted in balance v1
}
```

`TransactionType` includes `TRANSFER`, the transactions filter offers types, and analytics treat
transfer as "neither income nor expense" — but neither the source nor the destination account is
debited/credited.

**Effect:** a user recording a transfer sees a history row with **zero** financial impact; per-account
balances become wrong.

---

## B13 🟢 Settings → "Delete Account" is a stub — **CONFIRMED**

**Where:** `app/(app)/settings/page.tsx` (~line 314 region: input `placeholder="DELETE"`)

The confirmation flow ends in a toast saying the feature is not implemented. Meanwhile
`DELETE /api/account` exists, performs `prisma.user.delete({where:{id:userId}})` and returns
`"Your account and all financial data have been permanently deleted"` — but it is never called,
isn't audited (`AuditAction.ACCOUNT_DELETED` is declared but unused), doesn't require a password
(SECURITY F6) and doesn't clear the session cookie.

---

## B14 🟢 Landing page shows hardcoded fake data — **CONFIRMED**

**Where:** `app/page.tsx`

The marketing hero renders static statistics and a scripted chat demo with no API backing.
Harmless for marketing, but it is misleading in a product whose whole point is real numbers, and
it is a trap for future maintainers who may think the data is live.

---

## B15 🟢 Preferences are inert — **CONFIRMED**

| Field | Written by | Read by |
|---|---|---|
| `UserPreference.currency` | `PATCH /api/preferences` | **nothing** — `lib/utils/format.ts` hardcodes `INR` |
| `UserPreference.dateFormat` | same | **nothing** — hardcodes `en-IN` + `"d MMM yyyy"` style |
| `notifyBudget` / `notifyGoal` / `notifyAIInsight` / `notifyRecurring` | same | **nothing** — no producer checks them |
| `Profile.monthlyIncome` | onboarding, profile | **nothing** — health score uses real transactions |
| `Transaction.tags` | (declared in schema) | **nothing** in app code |
| `Budget.period` | create form | **nothing** — window is `startDate → endDate ?? today` |
| `DashboardData.hasAnyData` | `getDashboardData` | **nothing** — empty state never switches |
| `Notification.link` | producers | **not used for navigation** on click |
| `NEXT_PUBLIC_APP_URL` | `.env` | no code reference found |

**Effect:** users can change these settings and observe **no behavioural change**.

---

## B16 🟢 Duplicate "mark all read" endpoints — **CONFIRMED**

`PATCH /api/notifications` and `POST /api/notifications/read-all` both call
`markAllNotificationsRead()` and return the same payload. Two ways to do one thing.

---

## B17 🟢 Unvalidated pagination on notifications — **CONFIRMED**

```ts
const page = Number(url.searchParams.get("page") ?? 1);   // NaN possible
const pageSize = Number(url.searchParams.get("pageSize") ?? 20);
…skip: (page - 1) * pageSize
```
`?page=abc` → `skip: NaN` → Prisma error → 500. Unlike `transactionQuerySchema`, there is no
`int().min(1)` guard or `pageSize ∈ {20,50,100}` refinement.

---

## B18 🟢 Global category uniqueness leaks across tenants — **CONFIRMED (schema)**

```prisma
model Category { … @@unique([name, isSystem]) }
```

Two different users cannot both own a custom (`isSystem=false`) category called "Food". The
service-level conflict check (`category.service.createCategory`) filters by `userId`, so it catches
the ordinary case with a 409; the race case or a direct API call hits a Prisma `P2002` that
`handleRoute` turns into `500 INTERNAL`.

**Not currently reachable from the UI** (no category creation UI), which is why this is Low.

---

## B19 🟢 `npm run db:seed` destroys every tenant — **CONFIRMED**

`prisma/seed.ts` starts with `deleteMany()` on all models **including `user`**. Running the seed
against a shared database wipes all real users, not just the demo account.

Also: the script declares `const PASSWORD = "Demo@1234"` but never uses it (the actual hash is for
`Demo@123`), and it types **all** system categories as `EXPENSE` — including Salary, Freelance,
Business, Interest, Gift and Other Income — with `icon: null, color: null`, diverging from
`lib/constants` where they are `INCOME` with colours.

---

## B20 🟢 Dead code and dead assets — **CONFIRMED**

| Item | Evidence |
|---|---|
| `app/(marketing)/layout.tsx` | the group contains no `page.tsx` → no route |
| `date-fns` dependency | declared in `package.json`, zero imports anywhere |
| `components/ui/textarea.tsx`, `components/ui/tooltip.tsx` | zero importers |
| `BUDGET_ALERT_THRESHOLDS` constant | defined, never imported (thresholds hardcoded in `crossedThreshold`) |
| `category.service.ensureSystemCategories()` | defined, never called |
| `notification.service.markNotificationRead()` | defined, never imported by a route |
| `forecast.ts` `budgetStatuses` + `void budgetStatuses` | query executed, result discarded |
| `health-score.ts` empty `if` block | body is only a comment |
| `prisma/seed.ts` `const PASSWORD` | unused |
| `ReportType` values `SPENDING_ANALYSIS`, `BUDGET`, `SAVINGS`, `FINANCIAL_HEALTH` | declared, never written |
| `NotificationType` values `RECURRING_UPCOMING`, `AI_RECOMMENDATION` | declared, never produced |
| `AuditAction` values `LOGOUT`, `AI_REPORT_GENERATED`, `ACCOUNT_DELETED` | declared, never written |
| `.next/BUILD_ID` | absent → the `.next` dir is a dev artefact, not a production build |

---

## Structural / cross-cutting problems

### S1 · Two sources of truth for categories — **CONFIRMED**
`lib/constants/*_CATEGORIES` (22 entries with icon+colour, drives every dropdown) vs `Category`
table rows (drives FKs, seeded with wrong `type` and no icon/colour). They are never reconciled.
This single divergence is the root cause of **B1, B2, B4**.

### S2 · Two sources of truth for validation — **CONFIRMED**
`lib/validation/schemas.ts` **and** inline schemas inside route files
(`app/api/budgets/[id]/route.ts`, `app/api/goals/[id]/route.ts`, `app/api/analytics/trends/route.ts`).
They have drifted — most visibly the `null` handling that causes **B3** and **B6**. Unit tests only
exercise the `lib/` schemas, so the drift is invisible to CI.

### S3 · No integration tests — **CONFIRMED**
67 passing tests cover only pure functions. No test invokes an API route or a page payload, which
is exactly why B1–B8 all pass the quality gates.

### S4 · Silent client error handling — **CONFIRMED**
Every page uses `if (!data.success) toast(...)` with no HTTP-status awareness. Consequences:
400s on filters look like empty results (B8), a 401 session expiry surfaces as
"Something went wrong", and there is no redirect to login on auth failure.

### S5 · No job scheduler — **CONFIRMED**
Recurring materialisation and goal-deadline checks only run inside `GET /api/dashboard`.
If nobody opens the dashboard, recurring transactions never post. There is no cron/queue.

### S6 · GET with side effects — **CONFIRMED**
Follows from S5: `GET /api/dashboard` writes rows.

---

## Environment blockers encountered during this analysis

| Blocker | Impact |
|---|---|
| PostgreSQL not running (`Can't reach database server at localhost:5432`) | no runtime end-to-end verification; all findings are static + zod-execution based |
| Not a git repository | no history, no blame, no branches to compare |
| `.next/BUILD_ID` missing | production bundle not verified |
| `prisma/migrations/` absent | no SQL baseline to inspect or replay |

**UNKNOWN:** actual row volumes, real query plans, live AI provider behaviour without
`AI_API_KEY`, and whether `next-themes` state and `UserPreference.theme` stay in sync.
