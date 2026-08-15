# Net Worth History — Design

**Goal:** Give net worth a past. Today `accounts.current_balance` is a live figure with no history, so the app can show what you are worth but never how that changed. This adds stored balance snapshots, a reconstructed backfill for immediate value, a real net-worth delta, and a trend view on the dashboard.

**Scope:** Plan 10. The dense/pro visual overhaul is Plan 11 and is deliberately separate — this plan adds content to the dashboard; the next one restyles it. Building history first means the dashboard's information architecture gets redesigned once, with the trend chart already in place, rather than restyled and immediately reopened.

---

## Motivation: the current delta chip is wrong

`app/(app)/page.tsx` renders this inside the **Net worth** card:

```ts
const lastNet = rows[rows.length - 1]?.net ?? 0
const netLabel = lastNet >= 0 ? `▲ this month +${usd(lastNet)}` : ...
```

`lastNet` is `monthlyCashflow`'s net — income minus expenses. Presented inside the Net worth card as "▲ this month", a reader takes it as *how much my net worth moved this month*. It is not. It ignores every balance change without a transaction behind it: investment market moves, interest, fees Plaid reports as balance-only adjustments.

Net worth change and cumulative cashflow are different quantities, and the card currently conflates them. Fixing that conflation honestly is the point of this plan, and it constrains several decisions below.

## Decision: snapshot per-account balances, not aggregate net worth

`CLAUDE.md` states net worth is computed at query time, and `netWorth(accounts)` is a pure function applying the liability sign over account rows. Storing raw per-account balances preserves that: history records *observed facts* and net worth stays derived.

The alternative — storing one net-worth figure per day — freezes the formula at capture time. If the account-type mapping ever changes (a loan account starts counting as a liability), stored aggregates would be permanently wrong while per-account balances just recompute.

Cost is negligible: fewer than ten accounts at daily resolution is a few thousand rows a year.

## Schema — migration `0009_net_worth_history.sql`

```sql
create table account_balance_snapshots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  account_id uuid not null references accounts   on delete cascade,
  as_of      date not null,
  balance    numeric not null,
  source     text not null check (source in ('observed','reconstructed')),
  created_at timestamptz not null default now(),
  unique (account_id, as_of)
);
```

- RLS owner policy, matching every other table in this schema.
- Index on `(user_id, as_of)` — every read is "this user's series over a date range".
- `unique (account_id, as_of)` makes capture **idempotent**: running the sync twice in one day upserts the same row rather than duplicating the day.
- `source` is the observed/reconstructed marker. It is not cosmetic — it gates which points may be used for the delta figure.

## Capture — forward

A new step in the daily sync writes one row per account per day with `source='observed'`.

It runs **per user across all accounts, after `syncPlaidItems` returns — not inside the per-item Plaid loop.** Manual (non-Plaid) accounts hold balances too, and a net-worth series that silently omitted them would understate or overstate every point. The existing loop is keyed on `plaid_items`, so snapshotting must be its own pass.

**Gaps are accepted.** The job runs at 06:00 only when the machine is awake (a known Plan 6 limitation), so days will be missing. Net worth moves slowly; the chart plots the points that exist rather than implying daily resolution it does not have. No interpolation, no synthetic fill.

## Capture — backfill

A one-time script walks each account's balance backwards through its transactions, writing **month-end points across 13 months** with `source='reconstructed'`. Thirteen months matches the recurring detector's window and gives a year-over-year read.

**The direction of the walk depends on account type, and getting this wrong is silent.** `mapAccount` stores `current_balance` as Plaid's `balances.current`, which for a credit account is a *positive number representing debt owed*. `mapTransaction` stores `amount: -txn.amount`, so any outflow is negative. Those two conventions point opposite ways:

```
asset accounts (checking/savings/investment):
  balance(d-1) = balance(d) − Σ transactions(d)

liability accounts (credit):
  balance(d-1) = balance(d) + Σ transactions(d)
```

A $50 expense on a checking account means yesterday's balance was $50 *higher*. The same $50 charge on a credit card means yesterday's debt was $50 *lower*. Applying the asset formula to a liability account runs card debt backwards through every reconstructed month and produces a plausible-looking, entirely wrong net worth curve.

`reconstructBalances` therefore takes the account type and branches on the same liability rule `netWorth()` uses — imported, not restated, so there is one definition of what a liability is. This case gets an explicit unit test.

Month-end rather than daily is deliberate. Reconstruction is approximate, and daily resolution over approximate data implies a precision it does not have.

**Reconstruction is knowingly incomplete**, in exactly the way that motivates this plan: it can only see balance changes that have transactions behind them. Market moves, interest, and balance-only adjustments are invisible to it, so a reconstructed series tends toward cumulative cashflow — the very conflation being fixed. This is acceptable *only* because reconstructed points are marked, rendered distinctly, and excluded from the delta figure.

**Re-running is safe.** Upsert on `(account_id, as_of)` rewrites reconstructed rows, and the script filters to dates strictly before the first observed snapshot, so real data always wins over estimated.

## Pure logic — `lib/finance/net-worth-history.ts`

No Supabase, no React, `today` as a parameter and never the clock — the convention `recurring.ts` established.

- `reconstructBalances(currentBalance, accountType, transactions, months, today)` → `{ as_of, balance }[]`, walking backwards to month-end points, branching on asset vs. liability per the formulas above.
- `netWorthSeries(snapshots, accounts)` → per-date net worth, applying the liability sign via the existing account-type mapping.
- `netWorthDelta(series, days)` → change across the trailing `days` window, computed from **observed points only**; returns null when fewer than two observed points fall in it.

Reusing the existing liability rule rather than re-deriving it keeps one definition of net worth in the codebase.

## UI

**Net worth card.** Same shape, real number. The chip shows the **trailing 30-day** change from `netWorthDelta(series, 30)`, labelled with the actual span between the two observed points it used (e.g. "past 30 days", or "past 12 days" when that is all the observed data covers) — never a period longer than the data supports.

Thirty days is fixed and independent of the chart's 6M/12M toggle. The chip lives in the Net worth card and the toggle lives in the chart region; coupling them would make one component's label change when an unrelated control moved.

When `netWorthDelta` returns null — the state on day one, immediately after backfill — the chip renders `collecting since <date>` instead of a figure. No number beats a number derived from reconstruction.

A small sparkline sits in the card so the shape is visible without switching views.

**Trend chart shares the existing chart region.** The dashboard already has a full-width cashflow chart with a 6M/12M segmented control; stacking a second full-width chart makes a long page longer. That region gains a **Cashflow | Net worth** toggle and renders one or the other — same footprint, twice the information, reusing the segmented-control pattern already present.

**Reconstructed points render distinctly**: dashed stroke, muted fill, meeting the observed segment at the handoff date, with a legend naming them as estimated from transaction history.

**No separate history page.** Everything useful fits the space that exists.

**Constraints carried over from the June visual refresh:** hand-rolled SVG, no charting library, no new dependencies. Per [[svg-title-hydration-gotcha]], any SVG `<title>` takes exactly one string child — a single template literal, never interleaved `{}` expressions — or Next 16 throws a hydration mismatch.

## Data Flow

1. Daily sync refreshes Plaid balances and upserts `accounts` (unchanged).
2. New pass: for each user, read all accounts, upsert one `account_balance_snapshots` row per account at today's date, `source='observed'`.
3. Dashboard reads snapshots for the selected window, calls `netWorthSeries` to build the series and `netWorthDelta` for the chip.
4. Chart renders observed and reconstructed segments with distinct strokes.

## Errors & Edge Cases

- **No snapshots at all** (fresh account, backfill not run): card renders without chip or sparkline; the chart toggle omits the net worth option rather than showing an empty axis.
- **Fewer than two observed points:** chip shows `collecting since <date>`; the delta is never computed from reconstructed data.
- **Account deleted:** snapshots cascade. Correct — history describes accounts, and orphaned balances would distort the series.
- **Sync runs twice in a day:** unique constraint upserts; no duplicate days.
- **Machine off for days:** missing points, plotted as an unbroken line between the points that exist. Accepted, not interpolated.
- **Backfill re-run after observed data exists:** filtered to dates before the first observed snapshot; observed rows are never overwritten.

## Testing

Pure unit tests with `today` injected, matching every other `lib/finance/` module:

- `reconstructBalances` walks backwards correctly across a month boundary.
- **`reconstructBalances` on a liability account moves debt the opposite direction from an asset account given the same transaction** — the defect this spec's first draft contained.
- Liability accounts carry the right sign into `netWorthSeries`.
- `netWorthDelta` returns null with fewer than two observed points in the window, and ignores reconstructed points when observed ones exist.
- `netWorthDelta` reports the true span it measured, not the requested one, when observed data is shorter.
- A mixed observed/reconstructed series splits at the correct index for rendering.

Verification: `npx vitest run` green, `npm run build` clean, then a manual check once `0009` is applied and the backfill has run.

## Out of Scope (YAGNI)

- A dedicated net worth history page.
- Daily-resolution backfill.
- Interpolating or synthesizing missing days.
- Per-account history breakdown or composition-over-time charts.
- Snapshot retention/pruning policy — a few thousand rows a year needs no management.
- Any visual restyling. That is Plan 11.
