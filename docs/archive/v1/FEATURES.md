# Feature Inventory & Status

Status legend:
**✅ Works** — implemented and reachable end-to-end from the UI.
**⚠ Partial** — implemented but with a caveat or limited path.
**❌ Broken** — implemented but fails at runtime (see `KNOWN_ISSUES.md` for repro).
**🚫 No UI** — backend exists, no interface.
**⬜ Absent** — not built at all.

Evidence: **C** = confirmed by source/execution, **I** = inferred.

---

## 1. Authentication & account

| Feature | Status | Detail |
|---|---|---|
| Register (email + name + password) | ✅ | password rules: 8–128, ≥1 letter, ≥1 digit; duplicate email → 409 **C** |
| Login | ✅ | 401 with identical message for unknown user vs wrong password **C** |
| Logout | ✅ | deletes `em_session` cookie **C** |
| Remember me / refresh token | ⬜ | 30-day fixed TTL, no rotation **C** |
| Password reset / email verification | ⬜ | no mail integration **C** |
| MFA / sessions list / "log out everywhere" | ⬜ | **C** |
| Profile update (name, avatar) | ✅ | `GET/PATCH/PUT /api/profile` **C** |
| Change password | ✅ | Settings page; audits `CHANGE_PASSWORD` **C** |
| Delete account | ⚠ | `DELETE /api/account` works **but the UI button only toasts "not yet implemented"** **C** |
| Rate limiting | ⚠ | login 15/min/IP, register 10/min/IP; in-memory, spoofable IP **C** |

---

## 2. Onboarding

| Feature | Status | Detail |
|---|---|---|
| 5-step wizard (income → categories → budget → goal → done) | ✅ | `app/onboarding/page.tsx` **C** |
| Monthly income capture | ⚠ | saved to `Profile.monthlyIncome` but **never used by any calculation** **C** |
| Custom categories | ✅ | created as `type:"EXPENSE"`, `isSystem:false` **C** |
| First budget | ✅ | server constructs `startDate: new Date()` **C** |
| First savings goal | ✅ | **C** |
| First account | 🚫 No UI | API accepts `input.account` but the page **never sends it** → new users have **0 accounts** **C** |
| Occupation | 🚫 No UI | API accepts it, page never sends it **C** |
| Skip onboarding | ⬜ | always shown while `onboardedAt` is empty **C** |
| Post-login redirect honouring `?next=` | ✅ | middleware sets it; login page reads it **C** |

---

## 3. Transactions

| Feature | Status | Detail |
|---|---|---|
| List with pagination (20/50/100), sort, search | ✅ | `transactionQuerySchema` **C** |
| Filter by type / date range | ✅ | **C** |
| Filter by category | ❌ | sends category **name** as `categoryId` → 400 → silently ignored **C** |
| Filter by account / merchant / amount | ⬜ | schema supports `accountId`, `merchant`, `minAmount`, `maxAmount` — **page sends none of them** **C** |
| **Create transaction** | ❌ | `categoryId` = category name → `Invalid cuid` / "Category is required" → **always 400** **C** |
| **Edit transaction** | ❌ | same cause **C** |
| Delete transaction | ✅ | balance reversed **I** |
| Duplicate transaction | 🚫 No UI | `POST /api/transactions/[id]/duplicate` has no caller **C** |
| CSV export | ✅ | `<a href="/api/export?type=transactions" download>` **C** |
| CSV import | 🚫 No UI | `POST /api/transactions/import` (max 2000 rows) has no caller **C** |
| Payment method / location / notes fields | ⚠ | schema + page support `paymentMethod`, `notes`, `location`; page only exposes description/merchant/date/payment **I** |
| Account balance adjustment | ⚠ | `EXPENSE −`, `INCOME +`, **`TRANSFER` = 0** (transfers move nothing) **C** |
| Post-create budget / anomaly notifications | ✅ | failures swallowed, never block creation **C** |

---

## 4. Income

| Feature | Status | Detail |
|---|---|---|
| Income list (income-typed transactions) | ✅ | **C** |
| **Add income** | ❌ | `categoryId` = source name → 400, same bug as transactions **C** |
| Edit / delete income | ❌ / ✅ | edit shares the transaction payload bug **C** |
| Export income CSV | ⬜ | only `type=transactions` export exists **C** |

---

## 5. Accounts

| Feature | Status | Detail |
|---|---|---|
| List accounts | 🚫 No UI | read only by transaction forms and dashboard **C** |
| Create / edit / archive / delete account | 🚫 No UI | full `GET/POST/PATCH/DELETE` API **C** |
| Total balance | ⚠ | computed from `Account.balance` — **stays ₹0 for any newly registered user** **C** |
| Balance history / statements | ⬜ | **C** |
| Transfer between accounts | ⚠ | a `TRANSFER` type exists but moves no money **C** |

> This is the single largest product gap: without an accounts UI, the app's headline
> "Total Balance" figure can never become non-zero for real users.

---

## 6. Categories

| Feature | Status | Detail |
|---|---|---|
| System categories (22) | ⚠ | defined **twice**: `lib/constants/index.ts` (used by UI) and DB rows (used by relations) **C** |
| Category CRUD | 🚫 No UI | full API with conflict checks **C** |
| Custom colours / icons | ⚠ | constants carry `color`/`icon`; **seeded DB rows have `icon: null, color: null`** **C** |
| Category badge colours in UI | ⚠ | populated only from constants, not DB **I** |

---

## 7. Budgets

| Feature | Status | Detail |
|---|---|---|
| List with live spent/remaining/utilization | ✅ | **C** |
| Create without a category | ✅ | **C** |
| **Create with a category** | ❌ | category name as `categoryId` → `Invalid cuid` **C** |
| **Edit budget** | ❌ | sends `categoryId: null`, update schema has no `null` branch → **always 400** **C** |
| Edit silently drops existing category | ❌ | `openEdit` hardcodes `setFormCategoryId("")` **C** |
| Delete budget | ✅ | **C** |
| Period selection (WEEKLY/MONTHLY/YEARLY/CUSTOM) | ⚠ | stored, **never used to derive the window** — window is `startDate → endDate ?? today` **C** |
| CUSTOM requires end date | ✅ | zod `.refine` **C** |
| Threshold notifications (50/75/90/100%) | ✅ | deduped per budget window **C** |
| Budget alerts toggle (`notifyBudget`) | ⚠ | stored, **never consulted** **C** |

---

## 8. Savings goals

| Feature | Status | Detail |
|---|---|---|
| List with progress, days remaining, required monthly saving, overdue | ✅ | `mapGoal` **C** |
| **Create goal** | ❌ | always sends `category: null` and `description: null` → 400. Works only if **both** are filled, despite description being labelled "Optional" **C** |
| **Edit goal** | ❌ | same; plus a cleared deadline is coerced to **1970-01-01** → permanent "Overdue" **C** |
| Contribute (`addContribution`) | ✅ | positive-only **C** |
| Delete goal | ✅ | **C** |
| Deadline notifications (14-day window) | ✅ | deduped per goal+date **C** |
| Goal deadline toggle (`notifyGoal`) | ⚠ | stored, never consulted **C** |

---

## 9. Recurring transactions

| Feature | Status | Detail |
|---|---|---|
| Model + engine (materialisation, idempotency, balance adjust) | ✅ | guard < 24 iterations/run **C** |
| CRUD API | ✅ | **C** |
| **UI of any kind** | 🚫 No UI | no page, no dialog, no nav item **C** |
| Background scheduler | ⬜ | engine only runs when `/api/dashboard` is hit **C** |
| `endDate` mid-backfill handling | ⚠ | compared against wall-clock, not the materialisation cursor **I** |

---

## 10. Notifications

| Feature | Status | Detail |
|---|---|---|
| Unread badge in shell | ✅ | **C** |
| Notifications page with list | ✅ | **C** |
| Mark all as read | ✅ | UI calls `POST /api/notifications/read-all` (a duplicate `PATCH /api/notifications` also exists, unused) **C** |
| **Mark one as read** | ❌ | UI calls `DELETE /api/notifications/[id]` → **deletes the record** **C** |
| Read-all route duplicate | ⚠ | `POST /api/notifications/read-all` does the same as `PATCH` **C** |
| Notification links | ⚠ | `link` is stored (`/goals`, `/budgets`, `/transactions`) but **clicking does not navigate** **I** |
| Types generated | ✅ | `BUDGET_THRESHOLD`, `BUDGET_EXCEEDED`, `GOAL_DEADLINE`, `UNUSUAL_TRANSACTION`, `REPORT_GENERATED` **C** |
| Preference toggles | ⚠ | `notifyBudget/Goal/AIInsight/Recurring` never read **C** |
| Email / push delivery | ⬜ | **C** |

---

## 11. Dashboard

| Feature | Status | Detail |
|---|---|---|
| Total balance, month summary, savings rate | ✅ | **C** |
| Category donut + 6-month trend | ✅ | Recharts **C** |
| Budget status cards | ✅ | **C** |
| Recent 8 transactions, accounts, unread count | ✅ | **C** |
| Runs recurring + deadline housekeeping on load | ⚠ | GET with side effects **C** |
| `hasAnyData` empty-state switch | ⚠ | computed, **never used by the page** **C** |

---

## 12. Analytics

| Feature | Status | Detail |
|---|---|---|
| Range presets (this_week/month, last_month, 3/6_months, this_year, custom) | ✅ | Monday-start weeks **C** |
| Financial summary + previous-period deltas | ✅ | **C** |
| Category breakdown | ✅ | **C** |
| Monthly trends | ✅ | **C** |
| Anomaly detection (3× or z≥3, ≥₹500, ≥5 samples) | ✅ | up to 100 sequential queries — slow **C** |
| Spending forecast + budgets at risk | ⚠ | works; contains a dead `void budgetStatuses` query **C** |
| Affordability verdict | ✅ | `can_afford` / `potentially_risky` / `not_recommended` **C** |
| Financial health score (0–100 + grade) | ✅ | 6 weighted components; has one empty `if` dead branch **C** |
| Currency / date-format preference applied | ⚠ | **hardcoded INR + en-IN** despite stored prefs **C** |

---

## 13. AI

| Feature | Status | Detail |
|---|---|---|
| Chat (`/ai`) | ⚠ | works, but **never sends `conversationId`** → no history, new conversation row per message **C** |
| Chat history / conversation list | ⬜ | **C** |
| Chat rate limit | ✅ | 20/min/user **C** |
| AI insights endpoint | 🚫 No UI | `GET /api/ai/insights` has no caller **C** |
| AI transaction analysis | 🚫 No UI | `POST /api/ai/analyze` has no caller **C** |
| Streaming responses | ⬜ | single JSON payload only **C** |
| Prompt-injection defence | ⬜ | only the "model never computes numbers" rule **I** |
| Behaviour without `AI_API_KEY` | U | not exercised in this analysis **U** |

---

## 14. Reports

| Feature | Status | Detail |
|---|---|---|
| Generate MONTHLY / QUARTERLY / YEARLY | ✅ | zod refines enforce month/quarter **C** |
| List reports | ✅ | **C** |
| Delete report | ✅ | **C** |
| View single report detail | 🚫 No UI | `GET /api/ai/reports/[id]` has no caller **C** |
| `REPORT_GENERATED` notification | ✅ | **C** |
| Export report to CSV/PDF | ⬜ | **C** |

---

## 15. Settings

| Feature | Status | Detail |
|---|---|---|
| Profile (name, avatar URL) | ✅ | **C** |
| Preferences (currency, date format, theme, notify toggles) | ⚠ | saved; **currency, dateFormat and all notify flags are never read** **C** |
| Theme light/dark/system | ✅ | next-themes toggle in shell **C** |
| Change password | ✅ | **C** |
| **Delete account** | ❌ | button is a stub; the API exists **C** |

---

## 16. Export / import

| Feature | Status | Detail |
|---|---|---|
| Export transactions CSV | ✅ | up to 10,000 rows in one query **C** |
| Export budgets CSV | 🚫 No UI | endpoint exists **C** |
| Import CSV | 🚫 No UI | API only; max 2000 rows **C** |
| Import preview flow | 🚫 No UI | `csvPreviewSchema` exists, no route uses it **C** |

---

## 17. Admin / audit

| Feature | Status | Detail |
|---|---|---|
| Audit log writes | ✅ | `REGISTER`, `LOGIN`, `CREATE_*`, `UPDATE_*`, `DELETE_*`, `IMPORT_TRANSACTIONS`, `CHANGE_PASSWORD` **I** |
| Audit log reader | 🚫 No UI | no `GET` route at all **C** |

---

## 18. Absent entirely (⬜)

Bank sync / open banking · receipt OCR · multi-currency FX · shared households · roles & permissions ·
mobile app / PWA / offline · email or push delivery · i18n · recurring cron · budget rollover ·
split transactions · refunds/reversals · attachments/receipts · tags · cash-flow calendar ·
budget templates · goals linked to accounts · CSV column mapping UI.
