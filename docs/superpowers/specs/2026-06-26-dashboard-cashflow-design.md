# Dashboard + Cashflow Charts — Design (Plan 5e)

**Date:** 2026-06-26
**Status:** Approved design — ready for implementation planning (Plan 5e)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app), and the Plan 5 feature slices — `2026-06-13-transactions-page-design.md` (5a — categories, signed amounts), `2026-06-13-budgets-page-design.md` (5b — `spentThisMonth`/`budgetStatus`), `2026-06-21-goals-page-design.md` (5c — `goalProgress`), `2026-06-21-bills-page-design.md` (5d — `nextDueDate`/`daysUntilDue`/`isPaid`). Reuses `lib/finance/{month,net-worth}.ts`.

## Overview

Plan 5e is the final slice of the decomposed Plan 5 (5a Transactions → 5b Budgets →
5c Goals → 5d Bills → **5e Dashboard + cashflow charts**). It replaces the
placeholder dashboard at `app/(app)/page.tsx` — currently a net-worth card plus four
"Coming soon" stubs — with a real landing page: the current net worth, a this-month
cashflow summary, a monthly **income / expense / net** chart with a 6/12-month toggle,
and four live widgets summarizing budgets, goals, bills, and recent transactions.

The chart is rendered with **hand-rolled SVG components** (no charting library) — all
number-crunching lives in a new pure, unit-tested `lib/finance/cashflow.ts` helper,
consistent with this project's pattern of pure math in `lib/finance` + thin native UI.

### Goals
- Replace the dashboard placeholder with a working landing page wired to real data.
- A **this-month cashflow summary**: Income / Expenses / Net for the current month.
- A **monthly cashflow chart** — grouped income (green) + expense (red) bars per month
  with a net line overlaid, and a **6-month / 12-month toggle**.
- Four **live widgets** (each linking to its full page): spent-vs-budget, goals
  progress, upcoming bills, recent transactions — fed from already-fetched data.
- A new pure `lib/finance/cashflow.ts` helper, unit-tested with Vitest.

### Non-goals (deferred / out of scope)
- **Net-worth trend line.** Net worth is computed from *current* account balances; no
  historical balance snapshots are stored, so a net-worth-over-time chart is not
  possible without a new snapshot table. Net worth stays a single current figure. The
  monthly **cashflow net** (income − expense) is the trend the dashboard provides.
- **A charting library** (Recharts/visx) — rejected in favor of custom SVG.
- **Chart interactivity** beyond the 6/12 toggle and native `<title>` hover tooltips
  (no zoom, pan, click-through, or JS-driven tooltips).
- **Fixed-vs-variable rollups** (floated in 5d) and **transaction splitting** (parked
  earlier) — not part of 5e.

## Cashflow logic (`lib/finance/cashflow.ts`) — pure, unit-tested

New file. No Supabase/React deps. Income/expense exclude `Transfer` so that
credit-card payments and inter-account moves don't register as fake income/expense.

- **`monthlyCashflow(transactions, months): CashflowMonth[]`** — for each `'YYYY-MM'`
  in `months`, returns `{ month, income, expense, net }` where:
  - `income` = Σ of `amount` for positive-amount transactions whose `category !==
    'Transfer'`.
  - `expense` = Σ of `|amount|` for negative-amount transactions whose `category !==
    'Transfer'` (positive magnitude).
  - `net` = `income - expense`.
  - Months with no transactions return zeros, so the axis stays continuous.
- **`trailingMonths(current, count): string[]`** — the `count` months ending at
  `current` (oldest → newest), built with `shiftMonth`. Used for both 6 and 12.
- **`cashflowDomain(rows): number`** — the max of all `income`/`expense` magnitudes
  across the rows, for y-axis scaling. Returns a sensible non-zero fallback (e.g. `1`)
  when every value is zero so bars don't divide by zero.

`CashflowMonth` is `{ month: string; income: number; expense: number; net: number }`.
Date bucketing uses string `'YYYY-MM'` prefixes (consistent with `month.ts`); no
timezone math.

## Data flow

**`app/(app)/page.tsx`** (Server Component) — replaces the placeholder. Resolves the
session user (RLS) and fetches:
- **accounts** → `netWorth(accounts)` (unchanged).
- **transactions for the trailing 12-month window** in a single query
  (`date >= ` first-of-(current − 11 months)). This one result feeds the cashflow
  chart (sliced to 6 or 12 client-side), the this-month summary, the spent-vs-budget
  widget, and the recent-transactions widget — fetched once, sliced in memory.
- **budgets**, **bills**, **goals** → their respective widgets.

The server component computes the 12-month `monthlyCashflow` rows and passes them
(plus the widget data) to a **client component** that owns the 6/12 toggle state and
slices the rows. Fetching 12 months always (even when the toggle shows 6) keeps the
toggle instant with no refetch.

## Page & UI

**Layout (top → bottom; widget grid is 2-col on `sm+`, 1-col on mobile):**

1. **Net worth card** — the existing centered card, unchanged.
2. **This-month cashflow summary** (`components/dashboard/cashflow-summary.tsx`) —
   Income / Expenses / Net for the current month (the last `CashflowMonth`), `en-US`
   currency; Net colored green when ≥ 0, red when negative.
3. **Cashflow chart** (`components/dashboard/cashflow-chart.tsx`, client) — header with
   title + a **6M / 12M toggle** (two small buttons). Pure SVG: grouped vertical bars
   per month (income green, expense red) with a zero baseline, a **net `<polyline>`**
   overlaid, month labels on the x-axis, and a small legend. Bars/line scaled by
   `cashflowDomain`. Hover detail via native `<title>` elements (no JS tooltip).
4. **Widget grid** — four cards, each a component in `components/dashboard/`, each with
   a header link (→) to its full page, and each reusing `components/empty-state.tsx`
   when its slice is empty:
   - **Spent vs. budget** (`→ /budgets`) — top few budgeted categories, mini progress
     bar via `spentThisMonth` + `budgetStatus` (red when over).
   - **Goals progress** (`→ /goals`) — a few goals with `goalProgress` bars.
   - **Upcoming bills** (`→ /bills`) — next few unpaid bills by soonest
     `nextDueDate`, showing `daysUntilDue` (filtered by `isPaid`).
   - **Recent transactions** (`→ /transactions`) — last ~5 transactions (merchant,
     amount, date).

The client/server split exists because the 6/12 toggle needs client state; the summary
and widgets can be plain server-rendered children passed in, with only the chart (and
the small client wrapper holding toggle state) marked `"use client"`.

Reuses existing `Card`/`Button` + Tailwind; no new shadcn components, no new
dependencies.

## Error handling
- Failed Supabase reads in the page throw → route-segment `error.tsx` (Plan 3) retry.
- Each widget renders its own empty state when its slice is empty, and zero-filled
  months keep the chart axis intact — a brand-new account with no transactions shows a
  clean dashboard, not blank cards or a broken chart.

## Testing

Vitest; pure logic only (consistent with `lib/finance` being the tested layer — no
component/render tests).

- **`lib/finance/cashflow.test.ts`:**
  - `monthlyCashflow`: income from positive amounts, expense from negative (as positive
    magnitude), net = income − expense.
  - **Transfer exclusion** — positive and negative `Transfer` transactions contribute
    to neither income nor expense (the key case).
  - Zero-fill for months with no transactions.
  - `trailingMonths`: correct count and order, **year-boundary rollover**.
  - `cashflowDomain`: max magnitude across rows; **all-zero rows → non-zero fallback**.
- **Build/typecheck:** `npm run build` succeeds (dashboard renders); `npx tsc
  --noEmit` clean; full `npx vitest run` green.
- **Manual smoke test** (running app): the dashboard shows net worth; the this-month
  summary matches the current month's income/expense/net; the chart renders 6 months
  and the toggle switches to 12 without a refetch; each widget shows real data and
  links to its page; a transfer transaction does not move the income/expense bars.

## Done criteria
- `npx vitest run` green (new cashflow tests + all prior suites).
- `npm run build` succeeds; `app/(app)/page.tsx` renders the real dashboard.
- Cashflow chart shows monthly income/expense bars + net line with a working 6/12
  toggle; transfers are excluded from the math.
- Net worth remains a single current figure (no trend line); the four widgets show
  live budget / goal / bill / transaction summaries, each linking to its full page.
- No charting library added; the chart is custom SVG with logic in
  `lib/finance/cashflow.ts`.
