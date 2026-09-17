# Cash-flow Forecast — Design

**Date:** 2026-09-17
**Status:** Draft — awaiting approval
**Feature:** Project spendable cash over the next 30/60 days from tracked bills, untracked recurring charges, and detected income streams, so the user can see what is already committed before their next payday — and how low the balance gets first.

## Concept

Every other view in this app looks backwards. The dashboard says what net worth *is*, cashflow says what the last twelve months *did*, net worth history says where the balance *has been*. Nothing says what is about to happen, even though the app already knows most of it: bills carry real due dates, the recurring detector finds the charges that aren't tracked as bills, and paychecks are the most regular transactions in the file.

The question worth answering is not "what will my net worth be in 60 days" — it is **"how low does my cash get before the next paycheck, and does it go negative?"**

## What is being forecast

**Spendable cash, not net worth.** The starting position is the sum of `checking` + `savings` balances. Investment and credit accounts are excluded:

- You cannot spend a 401k. Including it would make a forecast that never dips.
- A credit account's balance is debt, not a resource. Adding it (signed either way) answers a different question.

This is a deliberate departure from `netWorth()`, which sums everything through `isLiability`. The forecast needs a **cash** figure, so it gets its own named helper (`spendableCash`) rather than bending the net worth one. The two numbers will differ on screen, and the UI has to say which it is showing.

**Known limitation — credit card spending.** Because credit accounts are out, day-to-day card spending does not reduce projected cash. The card *payment* does, but only if it is tracked as a bill or detected as recurring. For a user who puts most spending on a card and pays it monthly, the forecast is optimistic between payments. Stating this is the honest move; modelling statement cycles is a much larger feature and is a non-goal here.

## Projecting by interval, not by named frequency

Bills already have anchored due dates: `nextDueDate` handles all four frequencies including day-clamping and the quarterly anchor walk. The forecast reuses it as-is.

Detected streams are different. `BillFrequency` is `weekly | monthly | quarterly | yearly`, and `detectRecurring`'s bands are built around it — weekly 5–9 days, monthly 28–33. **Biweekly pay (14 days) and semi-monthly pay (~15 days) fall through every band**, and those are the two most common US pay cadences. Forcing income into a named frequency would either miss most paychecks or require a new `BillFrequency` value, which ripples into the bills table, forms, and `monthlyEquivalent`.

So the forecast projects detected streams as **`lastDate + k × medianIntervalDays`**. Forecasting does not need a cadence *name* — it needs the next occurrence dates, and the raw median interval gives them for any cadence uniformly. `detectRecurring` keeps its bands unchanged for the bills UI; it just stops discarding the median interval it already computes.

## Components

### `lib/finance/forecast.ts` (new, pure)

House rules apply: no Supabase or React imports, `today` always a parameter, unit-tested.

- `spendableCash(accounts: Account[]): number` — Σ balances of `checking` and `savings`.
- `detectIncomeStreams(transactions, today): IncomeStream[]` — inflows (`amount > 0`), `Transfer` excluded, grouped by `normalizeMerchant` (reused from `recurring.ts`). Keeps a group when it has ≥3 occurrences and passes the same regularity guards the expense detector uses (±20% interval, ±30% amount). Emits `{ merchantKey, displayName, amount, medianIntervalDays, lastDate, occurrences }`. No frequency name.
- `projectEvents(inputs, horizonDays, today): ForecastEvent[]` — every dated inflow/outflow in the window, ascending, each carrying `{ date, label, amount, kind: 'bill' | 'recurring' | 'income' }`.
- `runningBalance(start, events): ForecastPoint[]` — the cash curve.
- `forecastLow(points): { balance, date } | null` — the headline: lowest projected balance and when it lands.

### Double-counting rules (the load-bearing part)

Three ways the same money could be counted twice, all closed explicitly:

1. **A bill already paid this cycle.** `isPaid(bill, today)` is already exact — it auto-resets per cycle from `last_paid_date`. A paid bill's *current* occurrence is skipped; later occurrences inside the horizon still project.
2. **A recurring charge that is also a tracked bill.** The forecast consumes `matchCandidates(...).open` — the same buckets the bills page shows — so a promoted candidate is counted once, as a bill. Dismissed candidates are excluded too: dismissing means "not a recurring charge", and the forecast must respect that.
3. **A stream whose latest occurrence already happened.** Projection starts at the first `lastDate + k × interval` strictly after `today`, never at `lastDate` itself.

### `app/(app)/forecast/page.tsx` + components

Server page fetches accounts, bills, the 13-month transaction window, and dismissals — the same shapes the bills page already assembles. Zero new tables, **no migration**.

- **Headline:** projected low — "$X on Mar 4" — and, when it goes negative, a plain statement that it does, styled with the existing `expense` token.
- **Chart:** the cash curve over the horizon, hand-rolled SVG reusing `chart-geometry.ts` so it shares the coordinate system with the existing two charts. The whole line is a projection, so it renders in the estimated treatment the net worth chart already established for reconstructed runs — the visual vocabulary for "this is not measured" exists; reuse it rather than inventing a second one.
- **Event list:** every projected debit and credit with its date, amount and source, so the number is auditable. A forecast the user cannot take apart is a number they have no reason to believe.
- **Horizon control:** 30 / 60 days, matching the existing segmented-pill control.

### Dashboard

One stat linking to `/forecast`: the projected low and its date. This is the discoverability path — a page nothing links to does not get used.

### Nav

`/forecast` joins `LINKS` in `components/nav/nav-links.tsx`.

## Honesty rules

Consistent with the completeness guard and the reconstructed/observed split this codebase already enforces:

- **A projection is never rendered as a measurement.** The curve is dashed, labelled, and starts from today's real balance — which is the only measured point on it.
- **Nothing is invented to fill a gap.** No confidence bands, no smoothing, no "typical spending" padding. The forecast shows exactly the events it can name, and the UI says that variable day-to-day spending is *not* included — otherwise the projected low reads as a floor when it is really a ceiling.
- **The horizon is capped at 60 days.** Beyond that the interval guesses drift and quarterly/yearly bills dominate; a longer line would look more informative while being less true.

## Non-goals

- **No credit statement-cycle modelling.** Stated as a limitation above.
- **No budget-derived discretionary spending estimate.** It would be a guess dressed as an event, and it would make the projected low look safer than it is.
- **No new `BillFrequency` value.** Interval projection removes the need.
- **No stored forecasts.** Recomputed per page load, like recurring detection.
- **No alerts.** That is the other plan.

## Testing

Pure logic gets unit tests: `spendableCash` account-type selection; `detectIncomeStreams` on a biweekly paycheck (the case the bands miss), a semi-monthly one, an irregular payer that must be rejected, and a `Transfer` that must be ignored; `projectEvents` for each double-count rule above; `runningBalance`/`forecastLow` including a negative dip. Component tests cover the projection-is-labelled rule. Verification per task: `npx vitest run`, `npx tsc --noEmit`, `npm run build`, `npm run lint`.
