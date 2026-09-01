# Manual Balance History — Design

**Date:** 2026-09-01
**Status:** Approved (approach chosen over three alternatives: scoped-subset chart, segment-on-account-set-change, messaging-only)
**Feature:** Let the user record historical month-end balances from their statements, so net worth history has a real past instead of starting at the first observed capture. Resolves the reconstruction-coverage limitation recorded at the end of Plan 10.

## Problem

Plan 10 gave net worth a history table and a chart, then discovered on the real account set that the history is empty.

The chain: `reconstructBalances` derives past balances by walking `current_balance` backwards through transactions, and clamps at each account's oldest transaction (before that there is nothing left to subtract, so every earlier month-end would repeat one number — a flat line asserting "nothing changed" when the truth is "we have no information"). Plaid's `transactionsSync` returns transactions for depository and credit accounts only, so investments, loans, and secondary accounts reconstruct to **nothing at all**.

`netWorthSeries` then marks a date `complete: false` when fewer accounts contributed to it than to the fullest date in the series. Daily observed captures cover all 12 accounts; every backfilled month-end covers at most 5. So the entire backfill fails the guard and is withheld from both the chart and `netWorthDelta`. Measured 2026-08-18: 5 of 12 accounts reconstructible, all 20 backfilled rows unchartable.

**The guard is correct and stays.** Summing a 5-account total on one date and a 12-account total on another renders linking an account as a change in wealth — a bigger lie than the chip Plan 10 set out to remove. `hiddenHistory` already names the withheld dates, but naming them is all it can do.

The missing data is genuinely missing. Neither flat-lining absent accounts at `current_balance` (asserts a 401k never moved and a mortgage never amortized) nor reconstructing investment balances from investment transactions (a brokerage balance moves with the market, not with contributions) produces a true number. **The only real source for the missing history is the user's own statements.**

## Concept

A third snapshot provenance, `'manual'`: a balance the user attests to, read off a statement.

A manual balance is **real data, not an estimate**. For every downstream purpose — solid rather than dashed rendering, eligibility for `netWorthDelta`, counting toward a date's completeness — it ranks with `observed`. It is stored as a distinct value only so that automated writers can recognize it and never overwrite it.

Entry is per account, down a column of month-ends, because that is how the source documents are organized: you open one account's statements and type its numbers.

## Provenance vs. trust

Two distinct concepts that today share one name:

- **`SnapshotProvenance`** (new, database-level) — `'observed' | 'manual' | 'reconstructed'`. Where a stored row came from. Governs who may overwrite it.
- **`SnapshotSource`** (existing, series-level) — `'observed' | 'reconstructed'`. How much a *charted point* can be trusted. Governs dashed-vs-solid rendering and delta eligibility.

`netWorthSeries` maps provenance to trust on the way in: `manual → observed`, `reconstructed → reconstructed`. A date's trust stays "as weak as its weakest input" — any reconstructed contributor makes the point reconstructed.

Keeping `NetWorthPoint.source` two-valued is the point of this split: `netWorthRuns`, `netWorthDelta`, `hiddenHistory`, `sliceTrailingMonths`, `NetWorthSvg`, and `NetWorthSparkline` are all unchanged. `'observed'` at the series level should be read as "measured or attested", and is documented as such.

## Write precedence

One row per `(account_id, as_of)` — the table's unique key — so writers collide. The rule is **automated writers never overwrite a number a human stands behind**:

- **`captureBalanceSnapshots`** (daily) writes only *today's* date from `current_balance`, and keeps its plain upsert. For today, the live balance is the freshest truth; there is no past data for it to damage.
- **`scripts/backfill-net-worth.ts`** currently skips dates at or after each account's first *observed* snapshot. That boundary is the wrong shape for manual entries, which are scattered month-ends rather than a contiguous recent run. It becomes an exact date-set exclusion: load every **non-reconstructed** `(account_id, as_of)` pair and skip those cells. Strictly more correct than the boundary it replaces, and it makes the backfill safe to re-run after any amount of manual entry.
- **`saveBalanceHistory`** (new) writes `manual` rows only. It never touches an `observed` row.

## The date grid must align

Manual entries only help if they land on **exactly** the dates reconstruction uses. A manual 401k balance on 2026-03-30 next to a reconstructed checking balance on 2026-03-31 produces two incomplete dates instead of one complete one, and the chart stays empty.

So the canonical date list is extracted into one exported helper, `historyMonthEnds(months, today)`, and the three writers all call it: `reconstructBalances` (which computes the list inline today), the backfill script, and the manual entry page. The window is the same 13 months the backfill uses, excluding the current partial month whose month-end has not happened yet.

## Sign convention

`balance` is stored in the same convention as `accounts.current_balance`: **positive debt for credit accounts**, positive value for everything else. `netWorthSeries` applies `isLiability` to sign it.

This is the exact inversion Plan 10's spec self-review caught before it shipped, and hand entry is where it would come back. A user typing `-1500` for a card they owe $1,500 on would move their net worth $3,000 in the wrong direction. The form therefore labels the field by account type — **"Amount owed"** for credit accounts, **"Balance"** for everything else — and repeats the convention in helper text. Values are not sign-corrected on save: a credit account genuinely can hold a negative (overpaid) balance, and silently flipping a sign would be its own lie.

## What the user sees

### `/accounts/history` — Balance history

Reached from the Accounts page and from the dashboard's withheld-history note.

**Coverage summary (top).** One row per month-end in the window: the date, how many of the accounts have a balance for it, and what is missing. This is the part that tells the user what work unlocks the chart — without it, "fill in the gaps" is guesswork, and partial entry appears to do nothing because completeness is all-or-nothing per date.

The summary must be honest about the size of the job. The horizon clamp means the 5 reconstructible accounts only reach back about four month-ends, so the older dates need *every* account entered, not just the seven that reconstruct to nothing.

**Per-account entry.** Selecting an account shows its month-ends as a column of inputs. Each cell renders by the provenance of the row behind it:

| Existing row | Input | Badge |
|---|---|---|
| `manual` | the value, editable; clearing it deletes the row | Recorded |
| `observed` | the value, read-only | Captured |
| `reconstructed` | empty, with the estimate as a placeholder | Estimated |
| none | empty | Missing |

An estimate appears as a **placeholder, never a value**, so an untouched field cannot silently promote a guess to an attestation. Only cells the user actually types into become `manual`. Confirming an estimate is a real action the user takes by typing the number, and that is the correct bar for it.

One Save per account writes every changed cell.

### Dashboard

The `TrendPanel` withheld-history note gains a link to `/accounts/history`, so the explanation of what is missing sits next to the way to fix it.

## Components

### `lib/finance/net-worth-history.ts` (extended)

- `historyMonthEnds(months, today): string[]` — the canonical month-end list, extracted from `reconstructBalances`' inline `ends` computation, which now calls it.
- `SnapshotProvenance` type; `BalanceSnapshot.source` widens to it; `trustOf(provenance): SnapshotSource` maps it down.
- `coverageByDate(snapshots, accounts, dates)` → per date `{ as_of, covered, total, missingAccountIds }`. Drives the coverage summary and, at a glance, tells the user which dates are one account away from charting.

House rules apply: no Supabase or React imports, `today` always a parameter, unit-tested.

### `app/(app)/accounts/actions.ts` (new)

`saveBalanceHistory` — resolves the user from the session, validates each entry's date against `historyMonthEnds` (a date outside the grid is rejected, not silently written), upserts the touched cells as `manual`, deletes cleared cells that hold a `manual` row, leaves `observed` rows alone. Revalidates `/accounts/history` and `/` (the dashboard chart changes).

### `app/(app)/accounts/history/page.tsx` + `components/accounts/balance-history-*.tsx`

Server page fetches accounts and the window's snapshots; a client island holds the account selection and the input state.

### `supabase/migrations/0010_manual_balance_snapshots.sql`

Drops and re-adds the `source` check constraint to admit `'manual'`.

## Non-goals

- **No interpolation** between entered points, ever — the fabrication this whole feature exists to avoid.
- **No CSV import.** Revisit if hand entry proves painful in practice.
- **No change to the completeness guard.** It is doing its job; this feature feeds it.
- **No new account types.** Loans and mortgages stay whatever type the user picked.
- **No Plaid investments or liabilities products.** Rejected above on accuracy grounds, not effort.
- **No editing of `observed` captures.** Correcting a bad automated capture is a separate concern.

## Testing

Pure logic (`historyMonthEnds`, `trustOf`, `coverageByDate`, the `netWorthSeries` provenance mapping, `reconstructBalances` after the extraction) gets unit tests. `saveBalanceHistory` gets action tests against the existing Supabase mock helpers, covering auth, the off-grid date rejection, the manual-delete path, and the refusal to touch `observed` rows. Verification per task is `npx vitest run`, `npx tsc --noEmit`, and `npm run build`, plus a manual smoke test once `0010` is applied.
