# Bills Page — Design (Plan 5d)

**Date:** 2026-06-21
**Status:** Approved design — ready for implementation planning (Plan 5d)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app), `2026-06-13-transactions-page-design.md` (5a — categories, action/UI patterns), `2026-06-13-budgets-page-design.md` (5b — CRUD-dialog + Server-Action patterns), `2026-06-21-goals-page-design.md` (5c — modal/list patterns). Extends Plan 3's pre-built `lib/finance/bill.ts`.

## Overview

Plan 5d is the fourth slice of the decomposed Plan 5 (5a Transactions → 5b Budgets
→ 5c Goals → **5d Bills** → 5e Dashboard + cashflow charts). It adds a `/bills`
page: recurring bills with their next due date, an auto-resetting paid/due status,
and create/edit/delete. Supports all four frequencies (weekly, monthly, quarterly,
yearly). The page is a flat list sorted by soonest due, with a headline
"≈ $X/mo across N bills" summary.

### Goals
- A `/bills` page listing recurring bills as cards, sorted by soonest due, each
  showing next due date, days-until-due (or "overdue"), and a Paid/Due badge.
- Paid status that **auto-resets each billing cycle**, driven by a `last_paid_date`
  column (set/cleared by a "Mark paid / Mark unpaid" toggle).
- All four frequencies, anchored by a new `due_month` column for quarterly/yearly.
- A normalized **monthly-cost summary** (≈ $/mo) + a bill count.
- Create/edit/delete via Zod-validated Server Actions.

### Non-goals (deferred)
- **Fixed vs. variable rollups** — derived in 5e from bills (fixed/committed) vs.
  transactions (variable), using `monthlyCost`. No fixed/variable tag in 5d.
- **"Due this month" cash-flow total** — a possible 5e dashboard widget, not 5d.
- **Linking a paid bill to an auto-created transaction.**
- **Reminders/notifications; payment history** beyond the single `last_paid_date`.
- Dashboard / cashflow charts (5e).

## Data model

**Migration `0004_bills_scheduling.sql`** (applied via the Supabase SQL editor, like
`0001`–`0003`):
```sql
alter table bills add column due_month smallint;       -- anchor month (1–12) for quarterly/yearly
alter table bills add column last_paid_date date;       -- null = unpaid this cycle
alter table bills drop column is_paid;                   -- replaced by last_paid_date
```
The `Bill` type changes accordingly: drop `is_paid`, add `due_month?: number | null`
and `last_paid_date?: string | null`. Update the `bill()` factory in
`lib/finance/bill.test.ts` (it currently sets `is_paid`).

Column meaning by frequency (unchanged where noted):
- **weekly:** `due_day` = day-of-week (Sun=0…Sat=6); `due_month` unused.
- **monthly:** `due_day` = day-of-month (1–31); `due_month` unused.
- **quarterly:** `due_day` = day-of-month; `due_month` = anchor month, recurring every
  3 months (e.g. `due_month=1` → Jan/Apr/Jul/Oct).
- **yearly:** `due_day` = day-of-month; `due_month` = the month it's due.

## Bill logic (`lib/finance/bill.ts`) — pure, unit-tested

Preserve the existing, tested `nextDueDate` (weekly/monthly) and `daysUntilDue`
(Plan 3). **Extend/add:**
- **`nextDueDate` — add quarterly & yearly.** Yearly: the `due_month`/`due_day`
  occurrence this year if still ahead, else next year. Quarterly: the soonest of the
  four `due_month + 3k` occurrences on/after `from`, with year rollover. Clamp
  `due_day` to the month's length (e.g. day 31 in a 30-day month → last day).
  (Both previously returned `null`; the "deferred frequencies → null" test is
  replaced by real cases.)
- **`mostRecentDueDate(bill, from): Date | null`** — the latest due occurrence on or
  before `from` (the current cycle's start); the backward counterpart of
  `nextDueDate`. Used by `isPaid`.
- **`isPaid(bill, from): boolean`** — `last_paid_date != null` and
  `last_paid_date >= mostRecentDueDate(bill, from)`. So a payment counts for the
  current cycle and the bill auto-flips to Due once the next due date passes.
- **`monthlyCost(bill): number`** — normalized monthly equivalent: weekly
  `amount * 52 / 12`, monthly `amount`, quarterly `amount / 3`, yearly `amount / 12`.

All date math uses the existing UTC-midnight helpers (no timezone drift).

## Categories

Reuse `SPENDING_CATEGORIES` (controlled list minus Income/Transfer) with the same
dropdown + `isSpendingCategory` server validation as budgets. No bills-specific list.

## Server Actions (`app/(app)/bills/actions.ts`)

Same pattern as 5a/5b/5c: identity from the Supabase session, Zod validation,
`revalidatePath('/bills')`, typed `{ error }` | `{ success: true }`.

- **`saveBill(state, formData)`** — create or edit (hidden `id`). Zod:
  `name` non-empty; `amount` coerced positive; `category` passes `isSpendingCategory`;
  `frequency` ∈ {weekly, monthly, quarterly, yearly}; `due_day` coerced int in the
  valid range for the frequency (0–6 weekly, 1–31 otherwise); `due_month` coerced int
  1–12 **required for quarterly/yearly**, set to `null` otherwise (use a Zod
  `superRefine`/refine keyed on `frequency`). Insert `{ user_id, ... }` when no `id`,
  else `update(row).eq('id', id)`.
- **`setBillPaid(id, paid)`** — `paid === true` → `last_paid_date = today` (ISO);
  `false` → `last_paid_date = null`. `eq('id', id)`.
- **`deleteBill(id)`** — `.delete().eq('id', id)` (RLS scopes to the user).

## Page & UI

**`app/(app)/bills/page.tsx`** (Server Component) — replaces the placeholder.
Fetches the user's bills (RLS), passes them to the client view. Next-due sorting is
client-side (it's a computed value, not a SQL column).

**`components/bills/bills-view.tsx`** (client):
- **Header:** title + "+ Add bill".
- **Summary:** `≈ ${sum of monthlyCost}/mo across ${count} bills` (`en-US` currency).
- **Cards, sorted by soonest `nextDueDate`** (nulls last): name, category, amount,
  frequency; a status line — next due date + "due in N days" / "due today" /
  "N days overdue"; a **Paid/Due badge** from `isPaid`; a **Mark paid / Mark unpaid**
  toggle (calls `setBillPaid`); click the card body → edit. **Empty state** when none.

**`components/bills/bill-form.tsx`** (client modal, budgets/goals overlay pattern) —
`useActionState(saveBill)`; sonner toast + `router.refresh()` on success.
- Fields: name `<Input>`; amount `<Input type="number">`; category `<select>`
  (`SPENDING_CATEGORIES`); frequency `<select>` (four options); a `due_day` field
  whose **label switches** with frequency (weekday Sun–Sat for weekly, "Day of month"
  otherwise — a weekday `<select>` for weekly, a number input otherwise); a
  `due_month` `<select>` (Jan–Dec) shown **only** for quarterly/yearly. Delete button
  (calls `deleteBill`) when editing.

Reuses existing `Button`/`Card`/`Input` + native `<select>` + the modal pattern; no
new shadcn components.

## Error handling

- Server Actions validate with Zod → typed `{ error }` rendered inline / toasted.
- Supabase mutation errors → `{ error }` → sonner error toast.
- Failed reads in the page throw → route-segment `error.tsx` (Plan 3) with retry.
- No bills → friendly empty state.

## Testing

Vitest; Supabase mocked (reuse `lib/plaid/test-helpers`). UI via build + manual smoke.

- **`lib/finance/bill.test.ts`** (extend; keep the weekly/monthly cases, update the
  factory for the schema change, replace the "quarterly/yearly → null" test):
  - `nextDueDate` quarterly (this-quarter occurrence vs. roll to next; year rollover)
    and yearly (this-year vs. next-year; day clamping on a short month).
  - `mostRecentDueDate` for monthly/weekly/quarterly/yearly.
  - `isPaid`: paid within the current cycle → true; a payment before the current
    cycle's due date → false; `last_paid_date` null → false.
  - `monthlyCost`: weekly/monthly/quarterly/yearly conversions.
- **`app/(app)/bills/actions.test.ts`** — `saveBill` errors unauthenticated; rejects
  empty name / non-positive amount / non-spending category / missing `due_month` on
  quarterly; inserts on create, updates on edit; `setBillPaid(id, true/false)` writes
  `last_paid_date`; `deleteBill` deletes by id.
- **Build/typecheck:** `npm run build` succeeds (`/bills` listed); `npx tsc --noEmit`
  clean; full `npx vitest run` green.
- **Manual smoke test** (running app, after applying `0004`): add a monthly bill →
  card shows next due + "due in N days" and a **Due** badge; **Mark paid** → badge
  flips to **Paid**; add a yearly bill with a month/day → due date computed correctly;
  add a quarterly bill → next due is the soonest anchored quarter; the summary shows
  ≈ $/mo + count; edit and delete work.

## Done criteria
- `npx vitest run` green (extended bill tests, bills actions, all prior suites).
- `npm run build` succeeds with `/bills` rendering bill cards sorted by due date.
- All four frequencies compute a correct next due date; paid status auto-resets each
  cycle via `last_paid_date`.
- Summary shows normalized ≈ $/mo + bill count; categories from the shared spending list.
- Create/edit/delete and mark paid/unpaid work via the Server Actions.
- No fixed/variable rollups, no transaction linking, no reminders — those are later.
