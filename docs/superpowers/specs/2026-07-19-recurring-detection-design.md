# Recurring-Transaction Detection — Design

**Date:** 2026-07-19
**Status:** Approved
**Feature:** Detect recurring charges (subscriptions, regular bills) from transaction history, list them on `/bills`, and let the user promote a candidate to a tracked bill or dismiss it. Connects detection to the committed/fixed model shipped in Plan 8.

## Decision: Build our own detector (not Plaid's recurring API)

Plaid's `/transactions/recurring` endpoint was considered and rejected: it requires enabling an extra Plaid product and API surface, only covers Plaid-synced accounts (manual transactions invisible), and is a black box we cannot unit-test. Our own detector is pure, tested TypeScript over data we already have, works for manual transactions, and matches the house architecture (pure `lib/finance/` fed fetched rows). Accepted trade-off: Plaid's is likely smarter about messy merchant strings.

## Detection Algorithm — pure `lib/finance/recurring.ts`

**Input:** raw parent transactions (not exploded — detection is merchant-level, splits irrelevant), expenses only (`amount < 0`), `Transfer` category excluded, from a **trailing 13-month window** (13 so a yearly charge can occur twice).

**Grouping:** by normalized merchant key — `normalizeMerchant(name)`: lowercase, trim, collapse internal whitespace, strip trailing digit runs (e.g. `"NETFLIX.COM 4029"` → `"netflix.com"`). Empty keys (blank merchant) are skipped.

**Cadence classification:** for groups with ≥3 occurrences (≥2 when the single gap looks yearly), sort by date, compute consecutive-day intervals, take the median interval, and classify:

| Frequency | Median interval | Occurrence floor |
|---|---|---|
| weekly | 5–9 days | 3 |
| monthly | 28–33 days | 3 |
| quarterly | 85–95 days | 3 |
| yearly | 350–380 days | 2 |

Any median outside these bands (e.g. a 14-day cadence, which is not a supported bill frequency) → not a candidate.

**Regularity guard:** every individual interval must be within ±20% of the median interval; otherwise the group is rejected (filters erratic merchants like gas stations).

**Amount guard:** amounts need not be identical (utilities vary), but every amount magnitude must be within ±30% of the median magnitude; otherwise rejected (filters coincidental same-merchant purchases).

**Output:** `RecurringCandidate[]`, one per surviving group:

```ts
interface RecurringCandidate {
  merchantKey: string      // normalized key (identity for matching/dismissal)
  displayName: string      // most recent raw merchant_name
  frequency: BillFrequency // weekly | monthly | quarterly | yearly
  amount: number           // median magnitude, rounded to cents
  occurrences: number
  lastDate: string         // ISO 'YYYY-MM-DD' of most recent occurrence
  dueDayGuess: number      // weekly: day-of-week (Sun=0) of lastDate; others: day-of-month of lastDate
  dueMonthGuess: number | null // month (1-12) of lastDate for quarterly/yearly; null otherwise
  categoryGuess: string    // modal category across occurrences ('Split' parents count under 'Split'; if modal category is 'Split' or not a SPENDING_CATEGORIES member, fall back to 'Uncategorized')
}
```

Exported functions: `normalizeMerchant(name: string): string`, `detectRecurring(transactions: Transaction[], today: Date): RecurringCandidate[]` (the `today` param defines the 13-month window start; pure, no clock access).

## Tracked/Dismissed Matching — pure `matchCandidates`

`matchCandidates(candidates, bills, dismissedKeys)` buckets each candidate:

- **tracked** — some bill's `merchant_name` (normalized) equals the candidate's `merchantKey` (exact link, set on promote), **or** some bill's `name` fuzzy-matches (normalized bill name is a substring of the key or vice versa) — the fallback for pre-existing manual bills.
- **dismissed** — `merchantKey` is in `dismissedKeys`.
- **open** — otherwise.

Precedence: tracked > dismissed > open (a tracked candidate never shows as dismissed). Returns `{ open, dismissed }` (tracked candidates are not rendered — the bill list above already shows them).

## Schema — migration `0008_recurring_detection.sql`

- `alter table bills add column merchant_name text;` — nullable; stamped automatically when a candidate is promoted; never user-edited in the form.
- `create table recurring_dismissals` — `id uuid pk`, `user_id uuid FK → auth.users (cascade)`, `merchant_name text not null` (stores the normalized key), `created_at timestamptz default now()`, `unique (user_id, merchant_name)`, RLS owner policy (same shape as `transaction_splits`).

## UI — "Detected recurring" section on `/bills`

Rendered below the tracked-bills list:

- One row per **open** candidate: display name, amount + frequency badge (e.g. `$15.49 · monthly`), monthly-equivalent (`≈ $/mo` via the existing `monthlyCost` math applied to the candidate), occurrence count ("seen 7×"), and two actions:
  - **Track as bill** — opens the existing `BillForm` prefilled from the candidate (`name` = displayName, `amount`, `frequency`, `due_day` = dueDayGuess, `due_month` = dueMonthGuess, `category` = categoryGuess) with the candidate's `merchantKey` passed as a hidden `merchant_name` field. `saveBill` is extended to accept an optional `merchant_name`.
  - **Dismiss** — server action `dismissRecurring(merchantKey)` inserting into `recurring_dismissals`.
- A collapsed **"Dismissed (N)"** disclosure listing dismissed merchants, each with **Restore** (`restoreRecurring(merchantKey)` deletes the dismissal row).
- Empty state when there are no open candidates and no dismissals: the section renders a single muted line ("No recurring charges detected yet — candidates appear after a few months of history."). Follows the bills page's existing native-element + Tailwind idiom.

## Data Flow

`/bills` page (server) additionally fetches: trailing-13-month transactions and the user's `recurring_dismissals` (two new reads; no stored detection state). Then: `detectRecurring` → `matchCandidates` → pass `{ open, dismissed }` to the view alongside the existing bills props. Detection is recomputed per page load — nothing to go stale.

## Errors & Edge Cases

- Too little history → guards reject all groups → empty state.
- Plaid renames a merchant → the old candidate ages out of the 13-month window naturally.
- A promoted bill is later deleted → its candidate reappears as **open** (correct: no longer tracked).
- Dismiss then later "Track as bill" → allowed; a dismissal only hides the suggestion, never blocks tracking (tracked precedence also means promoting removes it from the dismissed list display).
- Duplicate dismissal insert → upsert/ignore on the unique key (no error toast for double-clicks).
- Candidate whose modal category is not a valid spending category → `categoryGuess` falls back to `'Uncategorized'` so the prefilled form is always valid.

## Testing

Unit tests (Vitest) for the pure module: `normalizeMerchant` (case/whitespace/trailing digits), cadence classification for all four frequencies plus rejection cases (14-day cadence, erratic intervals beyond ±20%, amounts beyond ±30%, <3 occurrences, yearly ≥2 rule), window filtering via the `today` param, `dueDayGuess`/`dueMonthGuess` derivation, `categoryGuess` modal + fallback, and `matchCandidates` (exact merchant link, fuzzy name fallback, dismissal, tracked-over-dismissed precedence). Actions and UI verified by `npm run build` + manual smoke test, per house convention.

## Out of Scope (YAGNI)

- Dashboard "untracked recurring" nudge widget (cheap later add)
- Price-change alerts and missed-charge notifications
- Plaid's recurring-transactions API
- Income-side detection (paychecks)
- Detection history / stored results
