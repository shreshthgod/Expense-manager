# Business logic (v2)

The rules every screen, report, export and assistant answer share. Each rule names the file that implements it; change a rule there and nowhere else.

**The core principle:** every number is computed deterministically on the server from recorded data. The AI layer only rephrases numbers it's given (see [AI](#ai-compute-first-then-narrate)).

---

## 1. Money and dates

| Rule | Where |
|---|---|
| Amounts are stored as `DECIMAL(14,2)`. All arithmetic that can accumulate (sums, differences, splits, carry-ins) is done in integer paise (`toMinor`/`fromMinor`) and converted once. | `lib/utils/money.ts` |
| An amount accepts at most 2 decimals and must be > 0 (sign comes from the transaction type). `CHECK (amount > 0)` in the database. | `lib/validation/primitives.ts`, migration 0002 |
| Display: whole amounts show no decimals (₹18,000); any paise show both digits (₹1,176.30). Liabilities are shown as "owed" (positive). | `lib/utils/format.ts` |
| Financial dates are calendar dates (`DATE` columns, `YYYY-MM-DD` strings). There is no time component, so there's no time-zone drift and never a 1970 date from a cleared field (cleared = `null`). | `lib/dates/date-only.ts` |
| "Today" is computed in the user's time zone (default Asia/Kolkata). | `todayFor()` in `server/services/user-settings.service.ts` |
| Ranges are start-inclusive, end-exclusive internally (`[start, end)`); UI and query `endDate` values are inclusive and converted once. | `lib/dates/date-only.ts`, `server/analytics/ranges.ts` |
| Financial months can start on any day 1–28 (payday cycles). Weeks start on the user's chosen weekday. | `financialMonthOf`, `startOfWeek` |
| Month arithmetic clamps to short months (31 Jan + 1 month = 28/29 Feb) and keeps the original anchor day for later months (31 Jan → 28 Feb → 31 Mar). | `addMonthsClamped` |

## 2. The ledger

Every account balance satisfies, at all times:

```
balance = openingBalance + Σ effects(POSTED, not deleted transactions touching the account)
```

`server/ledger/effects.ts` (`ledgerEffects`) is the only definition of effects; `server/ledger/sql.ts` (`signedEffectOn`) is its SQL mirror and a test compares the two.

| Type | Source account | Destination account | Counts as |
|---|---|---|---|
| EXPENSE | − amount | — | spending |
| INCOME | + amount | — | income |
| TRANSFER | − amount | + amount | neither |
| REFUND | + amount (to the receiving account) | — | reduces spending |
| ADJUSTMENT | − amount (account set) **or** + amount (destination set) | | neither |

- **Liabilities** (credit cards, loans) have negative balances while money is owed. A purchase on a card makes it more negative; a payment is a TRANSFER from a bank account to the card.
- **PLANNED** transactions (future-dated, or saved as planned) have no balance effect until posted. Posting can move the date to the posting date.
- **Deletes are soft**: the row keeps its history and its effects are reversed in the same database transaction; restore re-applies them (Undo).
- Every mutation runs in one transaction that locks the affected rows, writes the row, applies effects, writes the audit record and enqueues side-effect events (outbox). `verifyLedger()` recomputes balances from scratch; tests assert it after every scenario.
- **Opening balance** is what the account held (or owed) on its opening date. Changing it recomputes the balance. To match reality without rewriting history use **Adjust balance**, which records a dated ADJUSTMENT for the difference as of that date.
- **Archived** accounts keep counting in net worth and history; they're only hidden from pickers. Accounts with transactions can't be deleted.

## 3. Canonical definitions

Defined once in `server/analytics/definitions.ts` and reused by the dashboard, analytics, budgets, reports, exports and assistant tools.

```
actual        = status POSTED and not deleted
income        = Σ INCOME
grossExpense  = Σ EXPENSE
refunds       = Σ REFUND                      (on the refund's own date)
netSpending   = grossExpense − refunds        (may be negative)
surplus       = income − netSpending          ("kept")
savingsRate   = surplus / income × 100        only when income > 0, otherwise "not applicable"
```

TRANSFER and ADJUSTMENT never count as income or spending. Comparisons use the previous period of the same kind; month-to-date is compared with the same number of days of the previous month (never a partial month with a full one).

### Splits

A split transaction debits the account **once** for the full amount and allocates it to two or more categories. The lines must add up to the amount exactly (in paise). Every category-level aggregate reads `server/analytics/allocations.ts`, which yields one row per split line (or one per unsplit transaction), so a ₹5,000 purchase split ₹3,000 Food / ₹2,000 Household counts ₹3,000 + ₹2,000 — never ₹5,000 in both.

### Refunds

A refund is its own REFUND transaction linked to the original purchase (`originalTransactionId`). It credits the account that received it (a card refund reduces what's owed), reduces net spending **on the refund's date** in the refunded category, and total refunds can't exceed the purchase. A purchase with refunds can only be deleted together with them (explicit choice); refunds can't change amount/date/account after creation (delete and re-record).

## 4. Budgets

`server/analytics/budget-status.ts`, `lib/finance/cycles.ts`

- A budget has a scope (one category, or "all spending"), a period (WEEKLY, MONTHLY, YEARLY, CUSTOM), a start date (anchor) and an optional end.
- **Cycle** containing today: weekly cycles start on the user's week-start day; monthly/yearly cycles are anchored on the start date with month clamping; CUSTOM is the single start–end window.
- **Spent** = net spending in the scope during the cycle (allocations, by transaction date, POSTED only).
- **Rollover**: `NONE`, `POSITIVE_ONLY` (carry unused money) or `FULL` (carry unused money and overspending). Carry-in is computed oldest-first over at most 24 previous cycles: `carry_{k+1} = f(limit + carry_k − spent_k)` with `f = max(0,·)` for POSITIVE_ONLY. **Available** = limit + carry-in; utilisation, remaining and "exceeded" use Available.
- **Pace**: elapsed share of the cycle vs share of Available used; "ahead of pace" when usage is > 5 points ahead. Projection = spent / days elapsed × days in cycle.
- **Overlap rule**: two budgets with the same scope and period can't overlap in time. An overall budget and category budgets may coexist; they're never added together.
- **Alerts** at 50/75/90/100 % of the *current* cycle, once per budget, cycle and threshold (dedupe key), only if the user has budget alerts on.
- **Templates** save a set of repeating budgets. Applying one from a date previews every item (create / replace / skip). "Replace" ends the existing budget the day before so earlier cycles keep their history; nothing changes without confirmation.

## 5. Goals

`server/services/goal.service.ts`

- Kinds: SAVINGS, SINKING_FUND (optionally repeats yearly: the effective deadline rolls forward a year at a time), EMERGENCY_FUND.
- **Invariant:** `currentAmount = Σ GoalContribution.amount` and never below zero. `verifyGoalLedger()` checks it.
- Contributions: **earmark** (money already held is set aside; no balances change) or **transfer** (a real TRANSFER between two of the user's accounts is posted in the same database transaction and linked). Releases are negative contributions. Contributions can't be dated in the future.
- Removing a contribution never deletes its linked transfer (a real money movement); the user is told.
- Projections: `remaining = max(0, target − current)`; `required/month = remaining / max(1, ceil(daysRemaining / 30))`; pace = planned monthly contribution, else the last 90 days of contributions ÷ 3; `expected completion = today + ceil(remaining / pace)` months; on track when expected ≤ deadline.
- **Over-allocation**: if goals linked to an account claim more than its balance, a warning is shown (never a block).
- Milestones (25/50/75/100 %) and approaching deadlines notify once each.

## 6. Recurring items, bills and subscriptions

`server/services/recurring.service.ts`, `lib/finance/recurrence.ts`

- One engine for STANDARD recurring items, BILLs and SUBSCRIPTIONs (bills and subscriptions are always expenses).
- Schedule: every *interval* days/weeks/months/years from the start date (anchor), clamped for short months, optional end date. New rules never back-fill the past.
- Each due date becomes exactly one occurrence (`UNIQUE(recurringId, dueDate)`): SCHEDULED → DUE → RECORDED (a real transaction, linked) or SKIPPED; FAILED if auto-recording couldn't post (e.g. archived account) with the reason.
- Nothing is recorded automatically unless the user turns on "record automatically". Otherwise the scheduler marks it due and reminds; **Mark paid** records it (optionally with a different amount/date/account), **Skip** never creates a transaction, **Change amount** overrides one date only.
- Pause stops new occurrences; resume asks whether missed dates are skipped or recorded. Cancel ends the rule permanently; history stays. Catch-up after downtime is capped at 12 occurrences per rule per run.
- Monthly/annual equivalents: weekly × 52/12, yearly ÷ 12, etc.
- The scheduler (`server/jobs/scheduler.ts`) runs from cron (`POST /api/cron/run`), `npm run cron`, or throttled on app load (`/api/system/sync`, current user only). Rows are claimed with `SKIP LOCKED`, so overlapping runs can't double-record.

## 7. Credit cards

`server/services/account.service.ts` (`toAccountDTO`, `getCardStatement`)

- Only the last 4 digits are ever stored (validated; `CHECK` constraint). No full numbers, no CVV.
- **Utilisation** = owed / limit × 100; **available credit** = limit − owed.
- **Statement balance** = amount owed at the end of the most recent statement day. **Paid since** = transfers/adjustments into the card plus refunds/income on it after that date. **Amount due** = max(0, statement balance − paid since). **Due date** = first payment-due day after the statement date.
- Interest, fees and minimum due aren't invented; they appear only if recorded.

## 8. Reconciliation

`server/services/reconciliation.service.ts`

- The user enters a statement date and closing balance; the app compares with its balance **as of that date** and lists unreconciled records up to it.
- Completing requires a zero difference, or explicit consent to record a dated ADJUSTMENT for the remainder. Completion marks every posted record up to the date as reconciled.
- Changing or deleting a reconciled record needs confirmation (`409 RECONCILED_CHANGE`) and **reopens** the reconciliation. So does adding a record dated inside a completed period.

## 9. Import

`server/services/import.service.ts`, `lib/import/*`

- CSV only, up to 5 MB / 5,000 rows, parsed in the browser. Presets for common Indian bank/card exports plus saved custom mappings. Not a live bank connection.
- Preview validates every row (date format, amount, direction), matches categories (file → rules → merchant history) and scores duplicates 0–100 from amount, date distance and text similarity: **likely** (skipped by default), **possible** (flagged), **unique**.
- Nothing touches the ledger until confirm. Confirm commits the user's decisions in chunks; `UNIQUE(importJobId, importRowIndex)` makes a retried or concurrent confirm resume instead of inserting twice. A row can be classified as a transfer with another account (e.g. a card payment).
- Undo soft-deletes every transaction the import created (balances reverse).

## 10. Planning

`server/services/planning.service.ts`

- **Liquid money** = balances of BANK, SAVINGS, CASH and WALLET accounts.
- **Net worth** at a date = Σ (opening balance + posted effects up to that date) for accounts included in net worth that were open on that date; liabilities negative. History is recomputed from the ledger, so back-dated entries are reflected.
- **Cash-flow projection**: starts from today's liquid money and applies, per day, outstanding scheduled occurrences (overdue ones on today), PLANNED transactions not linked to an occurrence, and credit-card statement dues when no payment to that card is scheduled. Only effects on liquid accounts count (a transfer between two liquid accounts is zero; a card payment from the bank is an outflow). Expected income can be excluded. Unscheduled everyday spending isn't projected — the page says so.
- **Safe to spend** (until the end of the financial month) = liquid money − unrecorded commitments until month end − planned goal contributions not yet made this month. Expected income is shown separately ("if it arrives") and never included by default. Per day = safe ÷ days left.
- **Essential monthly spend** = net spending in categories marked Essential, averaged over the last 3 complete months with activity (all spending if nothing is marked, with a note).
- **Emergency cushion** = (emergency-fund goals, else liquid money) ÷ essential monthly spend, vs the user's target months.
- **What-if** = today's liquid money + average monthly surplus of the last 3 complete months (baseline) vs the adjusted surplus minus a one-time cost (scenario), month by month; money moved to goals leaves liquid cash but is reported as still yours. No interest or inflation.

## 11. Monthly review and snapshots

`server/services/review.service.ts`

- The review for a financial month shows totals vs the month before, categories, budgets whose cycle overlaps the month (as of its last day), bills paid/skipped/missed, goal contributions, net-worth change, top merchants and unusual expenses.
- Marking it reviewed stores a `FinancialSnapshot` (totals, category split, net worth, health score). The scheduler captures a snapshot for the last completed month automatically. If live net spending later differs from the snapshot (a back-dated edit), the review says so.

## 12. Insights, anomalies and health score

- **Unusual expense**: at least 5 earlier expenses in the category over 90 days, amount ≥ ₹500, and ≥ 3× the typical amount or z-score ≥ 3 (leave-one-out). Notified once per transaction. `server/analytics/detect.ts`
- **Insight cards** each carry the metric, the comparison, the data source and a "why am I seeing this" list of exact inputs. `server/services/insight.service.ts`
- **Health score** 0–100 (formula 2.0): savings rate 30, budget adherence 20, spending trend 15, recurring load 10, goal progress 15, emergency fund 10; components with too little data use a neutral default and say so. `server/analytics/health-score.ts`

## AI: compute first, then narrate

- Assistant tools (`agents/tools.ts`) are read-only and return computed data. The model (if configured) only phrases findings; without a provider the deterministic path answers.
- Narrations (reports, "explain my month", what-if) pass the model the exact figures. **Every number in the model's text must appear in those figures** (`agents/grounding.ts`); otherwise the template text is used instead.
- The assistant may **propose** actions (e.g. create a budget for the top category at its current spend rounded up to ₹500). Nothing is executed until the user confirms in the UI, which then calls the normal API with all its validation.
- Natural-language filters ("food above 1000 last month") are parsed deterministically into ordinary filter parameters.

## Notifications

Created only through `notify()` with a dedupe key (`UNIQUE(userId, dedupeKey)`), gated by the user's notification preferences, and produced by outbox handlers after the change has committed — never from a GET.
