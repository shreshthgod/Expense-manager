# Workflows

End-to-end journeys as the code actually implements them, not as the product intends.
Each step cites the file. Status ✅/❌ reflects measured behaviour.

---

## W1 · Register → onboarding → dashboard (happy path)

1. **`/`** landing page (marketing, hardcoded stats) → click Sign up.
2. `app/(auth)/register/page.tsx` → `POST /api/auth/register`
   - rate limit `register:<ip>` 10/min → `registerSchema`
   - bcrypt(10) hash → create `User` + nested `UserPreference` + `Profile`
   - `audit("REGISTER")` → set `em_session` cookie (30-day HS256 JWT)
3. Client `router.replace("/onboarding")` (no `onboardedAt` yet). ✅
4. `/onboarding/page.tsx` — 5 steps, client state only:
   - Step 1 Monthly income → `payload.monthlyIncome`
   - Step 2 pick categories → `payload.categoryNames[]`
   - Step 3 budget name+amount → `payload.budget = {name, amount}`
   - Step 4 goal name+target+deadline → `payload.goal = {…}`
   - Step 5 confirmation → `POST /api/onboarding`
5. `POST /api/onboarding` (C — `app/api/onboarding/route.ts`):
   - upsert `Profile.monthlyIncome`
   - create any not-yet-existing categories (`type:"EXPENSE"`, `isSystem:false`)
   - create budget (`period:"MONTHLY"`, `startDate: new Date()`), create goal
   - set `user.onboardedAt = now`
   - ❌ **`account` and `occupation` are never sent by the page**, so no account is created.
6. Redirect `/dashboard`. ✅

**Net result:** a new user has **zero accounts**. Every later "Total Balance" reads ₹0 and the
transaction form's Account dropdown is empty. (C)

---

## W2 · Post-login routing

- Middleware on protected routes without a valid token → `/login?next=<pathname>` (C)
- `middleware.ts` also redirects an authenticated user away from `/login` and `/register` → `/dashboard` (C)
- Login success → `router.replace(query.next || "/dashboard")` (C)

---

## W3 · Add a transaction (❌ broken)

1. `/transactions` → **Add Transaction** → dialog with amount, merchant, description, date,
   payment method, **category** (`filteredCategories` from `lib/constants`), **account**.
2. Submit `handleFormSubmit` (`app/(app)/transactions/page.tsx:151-184`) sends:
   ```jsonc
   { type, amount, description?, merchant?, transactionDate, paymentMethod?,
     categoryId: formCategoryId,      // ← the category NAME, e.g. "Food"
     accountId:  formAccountId }      // ← a real cuid from /api/accounts
   ```
3. `transactionCreateSchema` requires `categoryId` to be a **cuid**; the zod refine reports
   `"Category is required"` (or `"Invalid cuid"`).
4. `handleRoute` → **400 VALIDATION_ERROR** → page shows a toast and returns.
   The transaction is **never created**. ❌

**Same payload is used for `PATCH /api/transactions/[id]` → edit is equally broken.**

> Verified by executing the project's own `zod@3.25.76`:
> `TX CREATE categoryId="Food"` → `FAIL categoryId Category is required`.

### W3b · Filtering by category (❌ silently broken)
`fetchTransactions` sets `params.set("categoryId", categoryFilter)` where `categoryFilter` is a
name → `transactionQuerySchema` rejects it → 400 → the `.then` handler sees `success:false` and
leaves `data` untouched → **the list appears to ignore the filter with no error shown.** (C)

---

## W4 · Add income (❌ broken)

`app/(app)/income/page.tsx:112` sends `categoryId: formCategoryId` where the `<option>` values are
`INCOME_CATEGORIES` names (`Salary`, `Freelance`, …) → same `cuid` failure → 400. (C)

---

## W5 · Budget lifecycle (❌ create-with-category, ❌ edit)

**Create** (`app/(app)/budgets/page.tsx:86-107`)
- `body.categoryId = formCategoryId || null` where `formCategoryId` is a category **name**.
- No category chosen → `null` → `budgetCreateSchema` accepts `null` → **works** ✅
- Category chosen → `"Groceries"` → `Invalid cuid` → **400** ❌

**Edit** (`app/(app)/budgets/page.tsx:72-84, 93-94`)
- `openEdit` does `setFormCategoryId("")` (ignores the existing budget's category) (C)
- submit sends `categoryId: null`
- `budgetUpdateSchema.categoryId = z.string().cuid().optional()` — **no `null` branch** (C)
- → `Invalid input` → **every budget edit fails**, regardless of input (C)

**Delete** → `DELETE /api/budgets/[id]` → `deleteMany({id,userId})` → ✅

**Live status** (works independently of the form): `getBudgetStatuses` sums `EXPENSE`
transactions between `startDate` and `endDate ?? today`, scoped to `categoryId` when set. (C)

---

## W6 · Savings goal lifecycle (❌ create / ❌ edit, ✅ contribute)

**Create** (`app/(app)/goals/page.tsx:121-147`) always sends:
```jsonc
{ name, targetAmount, deadline: <"" → null>, category: <"" → null>, description: <"" → null> }
```
- `deadline: null` → `isoDate.optional().or(z.literal(null))` → accepted ✅
- `category: null`, `description: null` → `optionalTrimmed()` rejects `null` → **400** ❌
- Works only when the user fills **both** the category **and** the description (labelled "Optional").

**Edit** → same payload → same 400, **and**
`goalUpdateSchema.parse({deadline: null})` returns
`{"deadline":"1970-01-01T00:00:00.000Z"}` because `z.coerce.date()` runs before `z.literal(null)`.
If `category`/`description` were non-null the edit would "succeed" while silently
**back-dating the deadline to 1970** → goal renders *Overdue*. (C, executed)

Seeded goals have `category` set but **no `description`** → they can never be edited from the UI. (C)

**Contribute** (`PATCH { addContribution: n }`) → only `addContribution` is sent → ✅

---

## W7 · Recurring transactions (no UI)

No page or dialog references `/api/recurring`. The engine runs anyway:

1. `GET /api/dashboard` → `Promise.allSettled([processDueRecurrences, checkGoalDeadlines])` (C)
2. Select `active && autoCreate && nextExecutionDate <= now && endDate` null-or-≥now, `take 200`
3. Per row, inside `prisma.$transaction`:
   - loop from `nextExecutionDate` while `<= now` and `guard < 24`
   - insert `Transaction { isRecurring: true, recurringTransactionId }`
   - `advance()` +1d / +7d / `setMonth+1` / `setFullYear+1`
   - write `nextExecutionDate = cursor`, `lastExecutedAt = now`
   - adjust `Account.balance` by `± amount * max(1, guard)`
4. Idempotent because the cursor moves past `now`. (C)

**Implication:** the engine only fires when somebody loads the dashboard — there is no cron. (C)

---

## W8 · Notification lifecycle

**Producers (4 call sites, all in `server/`):**

| Trigger | Types | Dedupe key |
|---|---|---|
| After an expense is created | `BUDGET_THRESHOLD` / `BUDGET_EXCEEDED` at 50/75/90/100% | `<budgetId>:<startDate>:<threshold>` |
| After an expense is created | `UNUSUAL_TRANSACTION` when 3× or z≥3 | `anomaly:<txId>` |
| Dashboard housekeeping | `GOAL_DEADLINE` within 14 days | `goal:<id>:<YYYY-MM-DD>` |
| Report generated | `REPORT_GENERATED` | **none — not deduped** |

**Consumer:**
- Bell in `components/shell.tsx` → unread count ✅
- `/notifications` page → list ✅
- "Mark all read" → `POST /api/notifications/read-all` ✅ (the equivalent `PATCH /api/notifications` is unused)
- **Individual "mark as read" → `DELETE /api/notifications/[id]` → the row is destroyed** ❌ (C)

Preference flags `notifyBudget/notifyGoal/notifyAIInsight/notifyRecurring` are stored but **never
consulted by any producer** — toggling them changes nothing. (C)

---

## W9 · Analytics query flow

1. `/analytics` picks a preset (or custom range).
2. `GET /api/analytics/summary?preset=…` → `resolveRange()` (Monday-start weeks) →
   `getFinancialSummary(userId, range)`:
   - two `groupBy(type)` queries (current + previous range, `Promise.all`)
   - `savingsRate = round2((income-expenses)/income*100)`, 0 when income ≤ 0
   - `%` deltas vs previous range
3. `/api/analytics/categories`, `/api/analytics/trends?months=` → same range machinery.
4. Health score, forecast, affordability are computed on demand from raw SQL month buckets.

**Rule:** all numbers are computed in `server/analytics/*`; the AI only narrates them. (C)

---

## W10 · AI chat flow (⚠ history broken)

1. `/ai` → `POST /api/ai/chat` `{ message }` — **`conversationId` is never included** (C)
2. Rate limit `ai:chat:<userId>` 20/min → `aiChatSchema` (1–2000 chars)
3. `runAgentChat({userId, message, conversationId: undefined})`
4. Pipeline: intent → planner → tools (`server/services` + `server/analytics`) → analysis →
   decision → report
5. `agents/provider.ts` calls `AI_BASE_URL` with `AI_MODEL` / `AI_API_KEY`
6. Because `conversationId` is undefined, a **new `AIConversation` + `AIMessage` rows are created
   on every send**, and no prior messages are injected into the prompt. ❌

No streaming; a single JSON response is rendered.

---

## W11 · Report generation flow

1. `/reports` → type/year/(month|quarter) → `POST /api/ai/reports`
2. `reportGenerateSchema` + two `.refine()` guards enforce month for MONTHLY and quarter for
   QUARTERLY (C)
3. `report.service` runs the analytics suite, stores `AIReport.content (Json)`
4. `createNotification(REPORT_GENERATED)` (C)
5. `/reports` lists via `GET /api/ai/reports`, delete via `DELETE /api/ai/reports/[id]` ✅
6. `GET /api/ai/reports/[id]` (single fetch) has **no UI caller** 🚫

---

## W12 · Export flow

`/transactions` → **Export CSV** → `<a href="/api/export?type=transactions" download>` (C)

- `requireUserId()` → `listTransactions(userId, {page:1, pageSize:10000, …})`
- headers `date,type,category,merchant,description,amount,paymentMethod`
- RFC-style escaping (quotes, commas, newlines doubled)
- `Content-Type: text/csv` + `Content-Disposition: attachment; filename=transactions.csv`
- `type=budgets` works but is linked nowhere; unknown `type` → 400 `INVALID_TYPE`

---

## W13 · Settings flows

- Profile: `PATCH /api/profile` ✅
- Preferences: `PATCH /api/preferences` — accepts `currency ∈ {INR,USD,EUR,GBP}`,
  `dateFormat`, `theme`, four `notify*` booleans. All **persisted and ignored**. (C)
- Change password: verifies current, re-hashes, audits ✅
- **Delete account: button calls a stub that only toasts "not yet implemented"** —
  `DELETE /api/account` (which does exist) is never invoked. ❌ (C)

---

## W14 · Deletion semantics (database side effects)

| Deletion | Prisma behaviour | Consequence |
|---|---|---|
| Account | `Transaction.accountId → SetNull` | transactions survive but lose their account; **stored balance is not recomputed** (C) |
| Category | `Transaction.categoryId → SetNull`, `Budget.categoryId → SetNull` | blocked if transactions reference it (`category.service` conflict check) (C) |
| Budget / Goal / Recurring | direct `deleteMany({id,userId})` | orphan check: `count===0 → 404` (C) |
| Notification | direct `delete` by `id` (UI misuses this as "read") | (C) |
| User (seed only) | `deleteMany()` on **all tables** | **wipes every tenant**, not just demo (C) |

---

## W15 · Error-handling workflow (client side)

```
fetch(...) → res.json() → if (data.success) … else addToast(data.error.message, "error")
catch → addToast("Something went wrong", "error")
```

- No HTTP status inspection, no 401 → login redirect, no retry, no inline field errors. (C)
- A broken filter looks exactly like an empty result. (C, see W3b)
- Toast auto-dismisses after 4 s.
