# Cash-flow Forecast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project spendable cash over the next 30/60 days from tracked bills, untracked recurring charges, and detected income streams, headlined by the projected low and the date it lands.

**Architecture:** A new pure module `lib/finance/forecast.ts` turns three input sets into one dated event list, then into a running-balance curve. Bills project from `nextDueDate` (real anchors, already correct for all four frequencies); detected streams project from `lastDate + k × medianIntervalDays`, because biweekly and semi-monthly pay fall through every `BillFrequency` band. Starting position is **spendable cash** (`checking` + `savings`), not net worth — you cannot spend a 401k.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn-on-Base-UI · Zod 4 · Vitest · Supabase. No new dependencies, **no migration**.

## Global Constraints

- **A projection is never rendered as a measurement.** Today's balance is the only measured point on the curve; everything right of it renders in the estimated treatment `NetWorthSvg` already established for reconstructed runs.
- **Nothing is invented to fill a gap.** No confidence bands, no smoothing, no discretionary-spending padding. The UI states that variable day-to-day spending is excluded, so the projected low is not mistaken for a floor.
- **No double counting.** The three rules in the spec (already-paid occurrences, tracked candidates, already-past occurrences) are the correctness core of this feature — each gets its own test.
- **Pure logic stays pure** — `lib/finance/` takes no Supabase or React imports, and `today` is always a parameter, never the clock.
- **Horizon caps at 60 days.** A longer line looks more informative while being less true.
- **Next 16 conventions** (see `finance-tracker/web/AGENTS.md`): `cookies()` is async; shadcn Button composes via the `render` prop, not `asChild`; an SVG `<title>` takes exactly one string child (single template literal, never interleaved `{}`).
- Every task ends with `npx vitest run` green, `npx tsc --noEmit` clean, and `npm run build` succeeding. Then commit.
- All commands run from `finance-tracker/web/`.
- Rationale and locked decisions come from the spec `docs/superpowers/specs/2026-09-17-cashflow-forecast-design.md`.

---

## File Structure

**Created:**
- `lib/finance/forecast.ts` + `.test.ts` — the whole projection (Tasks 1–3).
- `app/(app)/forecast/page.tsx` — server page (Task 4).
- `components/forecast/forecast-view.tsx` — client island: horizon control (Task 4).
- `components/forecast/forecast-svg.tsx` + `.test.tsx` — the cash curve (Task 4).
- `components/forecast/event-list.tsx` — the auditable breakdown (Task 4).

**Modified:**
- `lib/finance/recurring.ts` + `.test.ts` — expose `medianIntervalDays` on `RecurringCandidate` (Task 1).
- `components/nav/nav-links.tsx` — add `/forecast` (Task 4).
- `app/(app)/page.tsx` — projected-low stat linking to `/forecast` (Task 5).
- `CLAUDE.md` / `AGENTS.md` — record the feature (Task 5).

---

## Task 1 — Inputs the projection needs

- [x] In `lib/finance/recurring.ts`, add `medianIntervalDays: number` to `RecurringCandidate` and populate it from the `med` already computed in `detectRecurring`. Purely additive — the bands and all existing fields stay exactly as they are.
- [x] Create `lib/finance/forecast.ts` with `spendableCash(accounts: Account[]): number` — Σ balances of `checking` and `savings` only. Document why this is not `netWorth()`: investments cannot be spent and a credit balance is debt, so a forecast built on either answers a different question.
- [x] Tests: `medianIntervalDays` matches the interval of a known monthly series; `spendableCash` sums depository accounts, ignores investment and credit, and returns 0 for an empty list.

**Verify:** every existing `recurring.test.ts` case passes untouched — the field is additive.

---

## Task 2 — Income streams

Detected by interval, not by frequency band, because biweekly (14d) and semi-monthly (~15d) pay falls through weekly (5–9) and monthly (28–33) alike.

- [x] Add `IncomeStream { merchantKey, displayName, amount, medianIntervalDays, lastDate, occurrences }` and `detectIncomeStreams(transactions, today): IncomeStream[]`: inflows only (`amount > 0`), `Transfer` excluded, grouped by `normalizeMerchant` (imported from `recurring.ts`, never restated), trailing 13 months.
- [x] Keep a group at ≥3 occurrences passing the same regularity guards the expense detector uses — every interval within ±20% of the median, every magnitude within ±30%. Emit the median amount and median interval; **no frequency name**.
- [x] Tests: a biweekly paycheck is detected with `medianIntervalDays ≈ 14`; a semi-monthly one is detected; an irregular payer is rejected; a `Transfer` inflow is ignored; a two-occurrence stream is rejected; expenses never appear.

---

## Task 3 — The projection

- [x] `ForecastEvent { date, label, amount, kind: 'bill' | 'recurring' | 'income' }` and `projectEvents({ bills, candidates, incomeStreams }, horizonDays, today): ForecastEvent[]`, ascending by date:
  - **Bills** walk `nextDueDate` forward through the horizon. Skip an occurrence only when `last_paid_date` is on or after it — that money already moved. Later occurrences still project.
    **Corrected mid-implementation:** this bullet originally said to skip on `isPaid(bill, today)`, and writing the test showed that is wrong. `isPaid` asks whether the cycle that *started* at the most recent due date is settled, so for a bill due the 25th, paying on 06-25 makes it true on 07-19 while the 07-25 charge is still owed — skipping on it would drop a real outflow and flatter the projected low. A regression test pins both directions.
  - **Candidates and income streams** project `lastDate + k × medianIntervalDays` for every k ≥ 1 landing in the horizon — strictly after `today`, so an occurrence that already happened is never re-counted.
  - Bills are negative, income positive; candidates negative (the detector emits magnitudes).
- [x] `runningBalance(start: number, events: ForecastEvent[]): ForecastPoint[]` — `{ date, balance }` after each event, starting from the measured balance at `today`.
- [x] `forecastLow(points): { balance, date } | null` — earliest point at the minimum balance; null on an empty series.
- [x] Tests, one per correctness rule: a bill paid ahead skips that occurrence but projects the next, and a bill whose *previous* occurrence was paid still projects the upcoming one; a candidate matched to a bill is absent (caller passes `matchCandidates(...).open`); a stream whose `lastDate` is inside the horizon does not double-count that occurrence; a quarterly bill lands once in 60 days and not at all in 30; `forecastLow` finds a negative dip and reports its date, and prefers the earliest of tied minima.

**Verify:** `projectEvents` is deterministic for a fixed `today` — no clock reads anywhere in the module.

---

## Task 4 — The forecast page

- [x] `app/(app)/forecast/page.tsx`: fetch accounts, bills, the 13-month transaction window and dismissals (same shapes `app/(app)/bills/page.tsx` already assembles), run `detectRecurring` + `matchCandidates` and pass **`open` only**, then project. No new tables.
- [x] `components/forecast/forecast-svg.tsx`: the cash curve, reusing `components/dashboard/chart-geometry.ts` so it shares one coordinate system with the existing charts. Whole line renders in the estimated treatment — it is all projection. A zero line when the curve crosses it.
- [x] `components/forecast/event-list.tsx`: every projected debit and credit with date, amount and source. A forecast the user cannot take apart is a number they have no reason to believe.
- [x] `components/forecast/forecast-view.tsx`: client island holding the 30/60 horizon control, matching the existing segmented-pill styling.
- [x] Headline: projected low and its date; when negative, say so plainly in the `expense` token. State that variable day-to-day spending is excluded, and that card spending only appears via a tracked bill or a detected recurring payment.
- [x] Add `/forecast` to `components/nav/nav-links.tsx`.
- [x] Tests: the curve is labelled as a projection; an empty event list renders an explanation rather than bare axes (the lesson `NetWorthSvg` already learned).

---

## Task 5 — Dashboard entry point and records

- [x] `app/(app)/page.tsx`: a projected-low stat linking to `/forecast`, computed from the data the dashboard already fetches plus bills (already fetched). Keep it to one figure — the page owns the detail.
- [x] Update `CLAUDE.md` **and** `AGENTS.md` in the same commit (they are the same document — mirror every edit): add the Plan 12 paragraph and the plan-list entry.

**Manual smoke test:**
1. `/forecast` shows a curve starting at today's real checking + savings total.
2. Every bill due in the next 30 days appears once, at its real due date.
3. Marking a bill paid removes its current occurrence and nothing else.
4. A detected recurring charge appears; promoting it to a bill keeps it at one occurrence, not two.
5. A paycheck appears on its real cadence — including if it is biweekly.
6. Switching 30 → 60 extends the line and can only lower or hold the projected low.
7. The dashboard stat matches the page headline.
