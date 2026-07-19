# Fixed-vs-Variable Spending Rollup — Design

**Date:** 2026-07-18
**Status:** Approved (brainstormed with visual companion; card layout Option A selected)
**Feature:** A dashboard card contrasting committed recurring costs ("fixed") with actual discretionary spending ("variable"), including the committed-share-of-income ratio. Deferred from Plans 5d/5e.

## Concept

Two complementary lenses on spending, deliberately **not** a strict partition of one total:

- **Fixed** = committed recurring cost from the `bills` table, normalized to a steady $/mo: `Σ monthlyCost(bill)` over all bills (reuses `lib/finance/bill.ts`). Forward-looking/expected, not actual cash moved.
- **Variable** = this month's actual discretionary spend from transactions: sum of expense magnitudes, **excluding** `Transfer` and `Bills & Utilities`. The `Bills & Utilities` category is treated as "fixed costs flowing through as transactions," which avoids double-counting a bill (e.g. rent) that also appears as a synced transaction.
- **Ratio** = committed as a percent of this month's actual income (income from the existing cashflow rollup).

Splits are honored: variable spend is computed over **exploded** rows, so a split with a `Bills & Utilities` part excludes exactly that part.

## Placement & Layout (approved via mockup)

A fifth widget in the existing dashboard 2-col grid (`app/(app)/page.tsx`); the grid wraps naturally, no layout changes. Card layout is **figures-first** (Option A from the visual session):

1. Label: "Fixed vs. Variable"
2. Two figures side by side: **$X/mo — Committed (N bills)** · **$Y — Variable this month**
3. A horizontal proportion bar splitting committed vs. variable as shares of `committed + variable` (blue / light-blue, same visual language as budget bars), with a two-item legend showing the percentages
4. Caption: *"Committed costs are Z% of this month's income"* — hidden when income is 0
5. Link: "Manage bills →" to `/bills`

## Components

### New pure module: `lib/finance/fixed-variable.ts`

House rules apply: no Supabase/React imports, unit-tested with Vitest.

- `totalCommittedMonthly(bills: Bill[]): number` — `Σ monthlyCost(bill)`; 0 for an empty list.
- `variableSpend(transactions: Transaction[], month: string): number` — Σ `|amount|` over rows with `amount < 0`, `date` in `month` (`YYYY-MM` prefix match, same convention as `monthlyCashflow`), skipping `category === 'Transfer'` and `category === 'Bills & Utilities'`. Callers pass **exploded** rows.
- `committedShareOfIncome(committed: number, income: number): number | null` — `(committed / income) * 100`, rounded to a whole percent; `null` when `income <= 0`.

### New component: `components/dashboard/fixed-variable-card.tsx`

Server component (like the other widgets). Props: `bills: Bill[]`, `transactions: Transaction[]` (exploded), `month: string`, `income: number`. Renders the approved layout; percentages for the bar derive from `committed + variable` (bar renders 100% variable when committed is 0, and vice versa; when both are 0 the bar renders as an empty muted track).

### Wiring: `app/(app)/page.tsx`

Zero new queries. The page already fetches bills, a 12-month transaction window, and splits, and computes `exploded` and `rows` (whose last entry holds this month's income). Pass those into the card and add it to the widget grid.

## Data Flow

```
bills ──────────────► totalCommittedMonthly ─► committed ($/mo)
transactions ─explodeSplits─► variableSpend(month) ─► variable ($ this month)
rows[last].income ──► committedShareOfIncome ─► ratio (% or null)
```

## Edge Cases

- **No bills** → committed $0; bar shows all-variable; card still renders.
- **No income this month** → ratio caption hidden (never ∞% or NaN).
- **No spending and no bills** → figures show $0; bar renders as an empty muted track.
- **Quarterly/yearly bills** → smoothed by `monthlyCost` by design (expected steady-state, not lumpy actuals).
- **Split transactions** → handled by feeding exploded rows; a `Bills & Utilities` split part is excluded from variable, its sibling parts are not.

## Error Handling

No new failure modes: the card consumes data the dashboard already fetches; Supabase errors degrade to empty arrays exactly as the existing widgets do.

## Testing

- **Unit (Vitest):** `lib/finance/fixed-variable.test.ts` — each function, plus: empty bills, mixed frequencies, month filtering, Transfer + Bills & Utilities exclusion, split-part exclusion via exploded rows, zero/negative income → `null`.
- **Build gate:** `npm run build`.
- **Manual smoke:** card appears on the dashboard with believable numbers; caption hides when the month has no income; "Manage bills →" navigates.

## Out of Scope (YAGNI)

- Configurable fixed-category list (only `Bills & Utilities` is excluded; revisit if it proves too blunt)
- Historical fixed-vs-variable trend
- Per-bill actual-vs-expected transaction matching
- Recurring-transaction detection (separate future plan)
