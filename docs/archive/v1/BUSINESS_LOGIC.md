# Business Logic

All formulas below are transcribed from source. Location is cited for every rule.
**Principle of the codebase:** every number is computed deterministically in `server/analytics/`
or `server/services/`; the AI layer may only narrate those numbers.

Helpers live in `lib/utils/money.ts`:

```ts
round2(v)                      // half-up to 2 dp, 0 for non-finite
safeDivide(n, d)               // 0 when d = 0 / non-finite
percentChange(old, new)        // round2((new-old)/|old| * 100), null when old = 0
percentageOf(total, part)      // round2(part/total*100), 0 when total = 0
mean(v), stdDeviation(v)       // sample std dev (n-1), 0 when |v| < 2
```

---

## 1. Ranges & periods

`server/analytics/ranges.ts`

| Helper | Definition |
|---|---|
| `startOfDay(d)` | `d @ 00:00:00.000` local |
| `endOfDay(d)` | `d @ 23:59:59.999` local |
| `startOfMonth(d)` | `new Date(y, m, 1)` |
| `endOfMonth(d)` | `new Date(y, m+1, 0, 23,59,59,999)` |
| `startOfWeek(d)` | **Monday-first**: `x.setDate(x.getDate() - ((getDay()+6)%7))`, then `setHours(0,0,0,0)` |
| `addMonths(d, n)` | `new Date(y, m+n, 1)` — day clamps to month end |
| `addDays(d, n)` | day arithmetic |

`resolveRange(preset, startDate?, endDate?)`:

| Preset | Start | End |
|---|---|---|
| `this_week` | Monday of current week | end of today |
| `this_month` | 1st of month | end of today |
| `last_month` | 1st of previous month | end of previous month |
| `3_months` | 1st of month-2 | end of today |
| `6_months` | 1st of month-5 | end of today |
| `this_year` | Jan 1 of year | end of today |
| `custom` | `startOfDay(startDate)` | `endOfDay(endDate)`, with `endDate < startDate` swapped; invalid/missing dates **fall back to `this_month`** |

`previousRange(range)` returns the immediately preceding range of equal length — used for
period-over-period deltas.

---

## 2. Financial summary

`server/analytics/summary.ts`

```
income    = Σ amount WHERE type = INCOME   AND date ∈ range
expenses  = Σ amount WHERE type = EXPENSE  AND date ∈ range
netSavings= round2(income - expenses)
count     = rows of both types in range
savingsRate = income > 0 ? round2(netSavings / income * 100) : 0
```

Deltas vs the previous range:

```
incomePct      = percentChange(prev.income,      cur.income)
expensesPct    = percentChange(prev.expenses,    cur.expenses)
savingsPct     = percentChange(max(0,prev.net),  max(0,cur.net))
savingsRateDelta = prev.income > 0 ? round2(curRate - prevRate) : null
```

`TRANSFER` rows are excluded entirely from income/expense grouping.

---

## 3. Account balance

`server/services/transaction.service.ts`

```
delta(type, amount) = EXPENSE → -amount
                      INCOME  → +amount
                      TRANSFER→ 0        // "between own accounts not double-counted in balance v1"
```

- Applied inside the same `prisma.$transaction` as the row insert.
- On update: old delta reversed, new delta applied (INFERRED from service shape).
- On delete: stored delta reversed.
- `getTotalBalance = Σ Account.balance` (`account.service.ts`).
- Recurring materialisation applies `± amount * max(1, guard)` where `guard` = rows created.

> **Consequence:** a `TRANSFER` transaction records history but changes no balance.

---

## 4. Budget utilisation

`server/analytics/budget-status.ts`

```
window      = [budget.startDate, budget.endDate ?? today]
spent       = Σ amount WHERE userId AND type=EXPENSE
                        AND transactionDate ∈ window
                        AND categoryId = budget.categoryId   [only when category-scoped]
utilization = percentageOf(budget.amount, spent)             // round2, 0 if amount = 0
remaining   = round2(budget.amount - spent)
```

```
crossedThreshold(u) = 100 if u ≥ 100
                    |  90 if u ≥  90
                    |  75 if u ≥  75
                    |  50 if u ≥  50
                    |  null otherwise
```

Thresholds `[50, 75, 90, 100]` are also declared as `BUDGET_ALERT_THRESHOLDS` in
`lib/constants/index.ts` — **that constant is not used**; the numbers are hardcoded in
`crossedThreshold`.

**`period` (WEEKLY/MONTHLY/YEARLY/CUSTOM) never affects the window.** Only `startDate`/`endDate` do.
A `CUSTOM` budget must supply `endDate` (zod `.refine`).

Notification dedupe key: `` `${budgetId}:${startDate.slice(0,10)}:${threshold}` ``
→ each threshold fires once per budget window while unread.

**Cost:** one `prisma.transaction.aggregate` **per budget** inside `Promise.all`.

---

## 5. Savings goals

`server/services/goal.service.ts::mapGoal`

```
remainingAmount       = round2(max(0, target - current))
progressPct           = target > 0 ? min(100, round2(current / target * 100)) : 0
daysRemaining         = round( (deadlineDay 00:00 − today 00:00) / 86400000 )
overdue               = daysRemaining < 0 AND remainingAmount > 0
requiredMonthlySaving = daysRemaining > 0 AND remainingAmount > 0
                        ? round2(remainingAmount / max(1, ceil(daysRemaining / 30)))
                        : null
```

Contribution: `PATCH { addContribution: n }` with `n > 0` adds to `currentAmount`.
`listGoals` orders by `createdAt asc`.

**Deadline notifications** (`goal-deadlines.service.ts`):
- window: `1 ≤ daysRemaining ≤ 14`
- skipped when `deadline` null, `remainingAmount ≤ 0`, or already overdue
- dedupe key `goal:<id>:<YYYY-MM-DD>`
- triggered from `GET /api/dashboard`

---

## 6. Anomaly detection

`server/analytics/detect.ts`

Constants: `MIN_ANOMALY_AMOUNT = 500`, `RATIO_TRIGGER = 3`, `ZSCORE_TRIGGER = 3`.

`evaluateExpenseAnomaly({userId, categoryId, amount, excludeTransactionId?})`:
1. history = last 90 days of `EXPENSE` in the same category (or all categories when `categoryId`
   is null), up to **400** rows, excluding the transaction itself
2. return `null` unless `history.length ≥ 5` **and** `amount ≥ 500`
3. `avg = mean`, `std = stdDeviation`
4. `ratio = round2(amount / avg)`, `zScore = (amount - avg) / std` (or `Infinity` when `std = 0`)
5. flag when `ratio ≥ 3` **or** `zScore ≥ 3`

`detectRecentAnomalies(userId, days = 30)`:
- candidates: `EXPENSE`, last N days, `amount ≥ 500`, newest first, **take 100**
- evaluates each candidate **sequentially** (up to 100 extra queries)
- returns the first 10 hits

Reason string: `"This is approximately X.X× your typical <category> transaction of ₹N."`

**Triggers:** after every expense creation (`afterExpenseCreated`) and in report generation.

---

## 7. Forecast

`server/analytics/forecast.ts`

```
trailing months      = the previous 4 calendar months (i-1 … i-4), via raw SQL date_trunc
expectedMonthlyExpenses = mean(complete month expenses)
expectedMonthlyIncome   = mean(complete month income)
expectedMonthlySavings  = expectedIncome − expectedExpenses
daysElapsedThisMonth    = today.getDate()
projectedMonthEndExpenses = dayOfMonth > 2
    ? round2(currentExpenses / dayOfMonth * daysInMonth)
    : round2(expectedMonthlyExpenses)
projectedMonthEndSavings  = round2(avgIncome − projected)
dataQualityMonths      = count of complete months actually present (≥ 0)
```

`budgetsAtRiskOfOverrun`: skipped entirely before day 3;
otherwise `utilization × (daysInMonth / dayOfMonth) > 100`.

Dead code inside this module: a `budgetStatuses` query filtered to `categoryId: null` is fetched
and immediately discarded with `void budgetStatuses` (CONFIRMED).

---

## 8. Affordability

`server/analytics/affordability.ts`

Inputs: `amount > 0`, optional `itemName`.

```
avgIncome, avgExpenses   = mean over complete months (fallback: the partial current month)
disposable               = round2(avgIncome − avgExpenses)
balance                  = Σ Account.balance
pctDisposable            = disposable > 0 ? percentageOf(disposable, amount) : Infinity

verdict =
  can_afford        if balance ≥ amount AND pctDisposable ≤ 100
  potentially_risky if balance + disposable ≥ amount AND (pctDisposable = ∞ OR ≤ 200)
  otherwise         not_recommended

monthsToSaveIfDeferred = disposable > 0
    ? max(1, ceil(max(0, amount − balance) / disposable))
    : -1
pctOfMonthlyDisposable = isFinite(pct) ? pct : -1
activeGoalPressure     = any goal with deadline > now AND (target − current) > 0
confidence             = "high" if ≥2 months, "medium" if 1, "low" if 0
dataQualityMonths      = months used
```

Served by `POST /api/ai/analyze` (deterministic — no LLM involved despite the path).

---

## 9. Financial health score

`server/analytics/health-score.ts` — 0–100, weighted across 6 components.

| # | Component | Weight | Computation | Default when data missing |
|---|---|---:|---|---|
| 1 | Savings Rate | **30** | `clamp((avgIncome−avgExpense)/avgIncome×100 / 30 × 100)` over the trailing ~3 months of raw-SQL buckets | 0 when no income |
| 2 | Budget Adherence | **20** | `% of budgets with utilization ≤ 100` | **70** when no budgets |
| 3 | Expense Growth | **15** | `clamp(100 + (prevMonthExpense − thisMonthExpense)/prevMonthExpense × 100)` | **60** when either month absent |
| 4 | Recurring Load | **10** | `clamp(100 − recurringLoad% × 2)` where recurring is normalised to a monthly figure (DAILY ×30, WEEKLY ×4.33, YEARLY ÷12, MONTHLY ×1) | 100 when income = 0 |
| 5 | Goal Progress | **15** | `mean(min(100, current/target×100))` | **50** when no goals |
| 6 | Emergency Fund | **10** | `clamp(balance / (3 × avgMonthlyExpense) × 100)` | **50** when no expenses |

```
score = clamp( round( Σ (componentScore × weight) / Σ weight ) , 0, 100 )
grade = "Excellent" ≥80 | "Good" ≥65 | "Fair" ≥45 | "Needs attention" <45
```

Known defect: the "last 3 complete months" intent is not enforced — there is an `if` block whose
body contains only a comment, so partial/current-month rows are summed unconditionally (CONFIRMED).

---

## 10. Recurring engine

`server/services/recurring.service.ts::processDueRecurrences(userId?)`

```
selection: active = true AND autoCreate = true
           AND nextExecutionDate ≤ now
           AND (endDate IS NULL OR endDate ≥ now)
           [AND userId = ?]     take 200

per row, inside prisma.$transaction:
  cursor = nextExecutionDate, guard = 0
  while cursor ≤ now AND guard < 24:
      create Transaction { isRecurring: true, recurringTransactionId, … }
      cursor = advance(cursor, frequency)   // +1d / +7d / month+1 / year+1
      guard += 1
  persist nextExecutionDate = cursor, lastExecutedAt = now
  if accountId AND type ≠ TRANSFER:
      balance += (type = INCOME ? +amount : -amount) × max(1, guard)
```

Idempotency: `nextExecutionDate` always lands strictly after `now`, so a repeat call in the same
request cannot re-materialise. Failures are caught per row and logged.

Known edge cases:
- `endDate` is compared against wall-clock `now`, not against `cursor` → a backfill can materialise
  slots past `endDate` (INFERRED).
- `max(1, guard)` would move `1 × amount` even if 0 rows were created (nearly unreachable).
- Triggered only from `GET /api/dashboard` — **there is no scheduler**.

---

## 11. Reports

`server/services/report.service.ts`

```
resolveReportRange:
  MONTHLY   → [new Date(y, m-1, 1), endOfMonth]
  QUARTERLY → [new Date(y, (q-1)*3, 1), new Date(y, (q-1)*3+3, 0, 23:59:59.999)]
  YEARLY    → [new Date(y,0,1), new Date(y,11,31, 23:59:59.999)]

title = "<Month> <Year> Monthly Report" | "Q<n> <Year> Quarterly Report" | "<Year> Yearly Report"
```

Pipeline: `collectReportStatistics` → `reportDataAvailability` → `narrateReport` (LLM) →
persist → `createNotification("REPORT_GENERATED")` (not deduped).

`content` JSON:
```jsonc
{ period, availability, overview, categories[≤8], budgets, goals,
  recurringMonthlyLoad, anomalies[≤5], healthScore, narrative }
```

---

## 12. Notifications rules

| Rule | Detail |
|---|---|
| Producers | exactly 4 call sites: budget thresholds, anomaly, goal deadline, report ready |
| Types actually produced | `BUDGET_THRESHOLD`, `BUDGET_EXCEEDED`, `GOAL_DEADLINE`, `UNUSUAL_TRANSACTION`, `REPORT_GENERATED` |
| Unused enum members | `RECURRING_UPCOMING`, `AI_RECOMMENDATION` |
| Dedupe | `metadata.dedupeKey` lookup restricted to `read: false` → keys re-fire after being read |
| Budget key | `<budgetId>:<YYYY-MM-DD of startDate>:<threshold>` |
| Anomaly key | `anomaly:<transactionId>` |
| Goal key | `goal:<goalId>:<YYYY-MM-DD>` |
| Report | no key |
| Preference flags | stored, never read |

---

## 13. Categories — dual definition

| Source | Used by | Contents |
|---|---|---|
| `lib/constants/{EXPENSE,INCOME,ALL}_SYSTEM_CATEGORIES` | every UI dropdown | 22 entries with `name/icon/color/type` |
| `Category` rows in Postgres | FK targets for transactions, budgets, recurring | seeded with `icon: null, color: null`, income names typed `EXPENSE` |

`category.service.ensureSystemCategories()` would upsert the constants into the DB with correct
types and colours — **it is never called** (CONFIRMED by grep).

Consequences:
1. UI sends names, API expects cuds → core create flows fail.
2. `category.service.createCategory` conflict check is tenant-scoped, but the DB constraint
   `@@unique([name, isSystem])` is global → cross-tenant `P2002` possible.
3. Seeded income categories have the wrong `type` relative to the constants.

---

## 14. What is *not* computed anywhere

- `UserPreference.currency` / `dateFormat` → formatting is hardcoded `INR` + `en-IN`
- `UserPreference.notify*` → never read
- `Profile.monthlyIncome` → never read (onboarding/health score use real transactions instead)
- `Transaction.tags` → never read or written by app code
- `Budget.period` → stored, never used for the window
- `DashboardData.hasAnyData` → computed, unused by the page
- `AuditLog` → write-only
- `Notification.link` → stored, not used for navigation
