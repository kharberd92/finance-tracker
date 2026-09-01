# Manual Balance History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record historical month-end balances from their statements as a third snapshot provenance (`manual`), so the accounts reconstruction cannot reach stop withholding the whole net worth history.

**Architecture:** Separate *provenance* (where a stored row came from — governs who may overwrite it) from *trust* (how much a charted point can be believed — governs dashed rendering and delta eligibility). `netWorthSeries` maps `manual → observed` on the way in, so every existing consumer of `NetWorthPoint` is untouched. One exported `historyMonthEnds` helper becomes the single source of truth for which dates history lives on, so manual entries land on exactly the dates reconstruction uses and the two combine into complete dates.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn-on-Base-UI · Zod 4 · Vitest · Supabase. No new dependencies.

## Global Constraints

- **The completeness guard does not change.** This feature feeds it; it does not relax it. Any task that makes an incomplete date chartable is wrong.
- **Nothing interpolates.** No value is ever derived between two entered points.
- **Pure logic stays pure** — `lib/finance/` takes no Supabase or React imports, and `today` is always a parameter, never the clock.
- **Sign convention:** `balance` matches `accounts.current_balance` — positive debt for credit accounts. Never sign-correct a user's entry.
- **Next 16 conventions** (see `finance-tracker/web/AGENTS.md`): `cookies()` is async; shadcn Button composes via the `render` prop, not `asChild`; a `<title>` in SVG takes exactly one string child.
- Every task ends with `npx vitest run` green, `npx tsc --noEmit` clean, and `npm run build` succeeding. Then commit.
- All commands run from `finance-tracker/web/`.
- Design values and rationale come from the spec `docs/superpowers/specs/2026-09-01-manual-balance-history-design.md`.

---

## File Structure

**Created:**
- `supabase/migrations/0010_manual_balance_snapshots.sql` — widen the `source` check constraint (Task 1).
- `app/(app)/accounts/actions.ts` + `.test.ts` — `saveBalanceHistory` (Task 4).
- `app/(app)/accounts/history/page.tsx` — server page (Task 5).
- `components/accounts/balance-history-view.tsx` — client island: account selection + input state (Task 5).
- `components/accounts/coverage-summary.tsx` — per-month-end coverage table (Task 5).

**Modified:**
- `lib/types.ts` — `AccountBalanceSnapshot.source` widens to `SnapshotProvenance` (Task 1).
- `lib/finance/net-worth-history.ts` + `.test.ts` — provenance/trust split, `historyMonthEnds`, `coverageByDate` (Tasks 1, 2).
- `scripts/backfill-net-worth.ts` — set-based exclusion of non-reconstructed cells (Task 3).
- `app/(app)/accounts/page.tsx` — link to `/accounts/history` (Task 5).
- `components/dashboard/trend-panel.tsx` + `.test.tsx` — link the withheld-history note to `/accounts/history` (Task 6).
- `CLAUDE.md` / `AGENTS.md` — record the feature (Task 6).

---

## Task 1 — Provenance vs. trust

Introduce the third provenance without changing any charted behavior yet.

- [x] Write `supabase/migrations/0010_manual_balance_snapshots.sql`: drop constraint `account_balance_snapshots_source_check` if it exists, re-add it as `check (source in ('observed', 'manual', 'reconstructed'))`.
- [x] In `lib/finance/net-worth-history.ts`, add `export type SnapshotProvenance = 'observed' | 'manual' | 'reconstructed'`, keep `SnapshotSource` as the two-valued trust level, and add `trustOf(p: SnapshotProvenance): SnapshotSource` mapping `manual → 'observed'`. Document that series-level `'observed'` means "measured or attested".
- [x] Widen `BalanceSnapshot.source` to `SnapshotProvenance` and `AccountBalanceSnapshot.source` in `lib/types.ts` to match.
- [x] Route `netWorthSeries` through `trustOf`, preserving its weakest-input rule: a date is reconstructed iff any contributor is.
- [x] Tests: a `manual` snapshot yields an `observed` point; a date mixing `manual` and `reconstructed` is `reconstructed`; a date mixing `manual` and `observed` is `observed`; manual snapshots count toward a date's completeness; a manual-only series is delta-eligible.

**Verify:** existing net-worth-history tests still pass unchanged — the point of the split is that no consumer moves.

---

## Task 2 — One canonical date grid

Make the dates reconstruction uses addressable, so manual entry can target them exactly.

- [x] Extract `reconstructBalances`' inline `ends` computation into an exported `historyMonthEnds(months: number, today: string): string[]` — the trailing `months` month-ends excluding the current partial month, ascending. `reconstructBalances` calls it.
- [x] Add `coverageByDate(snapshots: BalanceSnapshot[], accounts: Account[], dates: string[])` returning, per date, `{ as_of, covered, total, missingAccountIds }`. Counts distinct accounts with a snapshot on that date, ignoring snapshots for accounts that no longer exist (same rule `netWorthSeries` applies).
- [x] Tests: `historyMonthEnds` excludes the current month, handles a 31st/short-month boundary and a year rollover, and returns exactly what `reconstructBalances` emits against; `coverageByDate` reports a fully covered date, a partially covered one with the right missing ids, a date with nothing, and drops orphan snapshots.

**Verify:** `reconstructBalances`' own tests pass untouched after the extraction.

---

## Task 3 — Reconstruction never overwrites attested data

- [x] In `scripts/backfill-net-worth.ts`, replace the `>= firstObserved` boundary with an exact cell exclusion: query `(account_id, as_of)` for every snapshot whose `source <> 'reconstructed'`, build a key set, and filter each account's reconstructed points against it.
- [x] Keep the existing `skipped` counter and log line meaningful — it now counts cells held by real data of either kind.

**Verify:** re-running the backfill after manual entry leaves every manual row intact. State in the commit message that the script stays idempotent and non-destructive.

---

## Task 4 — `saveBalanceHistory`

- [x] Create `app/(app)/accounts/actions.ts` following the established action shape (`'use server'`, `ActionState`, session-resolved user, Zod validation, `revalidatePath`).
- [x] `saveBalanceHistory(accountId, entries)` where each entry is `{ as_of, balance: number | null }`:
  - reject when unauthenticated;
  - reject any `as_of` not in `historyMonthEnds(13, today)` — an off-grid date is a bug, not a value to store;
  - upsert entries with a number as `source: 'manual'` on the `(account_id, as_of)` conflict key;
  - delete rows for entries with `balance: null` **only where `source = 'manual'`**;
  - never write or delete an `observed` row;
  - `revalidatePath('/accounts/history')` and `revalidatePath('/')`.
- [x] Tests against `createSupabaseMock`/`createQueryStub`: unauthenticated; off-grid date rejected; a mixed batch upserts numbers and deletes nulls; the delete is scoped to `source = 'manual'`; a non-finite balance is rejected.

---

## Task 5 — The entry page

- [x] `app/(app)/accounts/history/page.tsx`: fetch accounts and the window's snapshots, compute `historyMonthEnds(13, today)` and `coverageByDate`, render the coverage summary plus the client entry island.
- [x] `components/accounts/coverage-summary.tsx`: one row per month-end — date, `covered / total`, and the missing account names. Make the shape of the job visible: the oldest dates need every account, because the horizon clamp stops reconstruction about four month-ends back.
- [x] `components/accounts/balance-history-view.tsx`: account selector; for the selected account a column of month-end inputs rendered by provenance per the spec's table (manual = editable value, observed = read-only, reconstructed = empty with the estimate as **placeholder**, none = empty). Label the field **"Amount owed"** for credit accounts and **"Balance"** otherwise, with the sign convention in helper text. One Save per account submits changed cells.
- [x] Link the page from `app/(app)/accounts/page.tsx`.

**Verify:** an untouched field never writes anything — a displayed estimate must not be able to promote itself to an attestation.

---

## Task 6 — Wire the dashboard and record the work

- [x] `components/dashboard/trend-panel.tsx`: the withheld-history note links to `/accounts/history` and says the missing balances can be added from statements. Keep the existing explanation of *why* the dates are withheld.
- [x] Update `CLAUDE.md` **and** `AGENTS.md` in the same commit (they are the same document — mirror every edit): add the Plan 11 paragraph, add Plan 11 to the plan list, and rewrite Plan 10's reconstruction-coverage limitation to point at its resolution.
- [x] Note in the migration list that `0010` must be applied before the feature works end-to-end.

**Manual smoke test** (after applying `0010`):
1. `/accounts/history` lists every month-end with an honest coverage count.
2. Entering a balance for a missing account saves and re-renders as Recorded.
3. Clearing a recorded balance removes it; a Captured cell cannot be edited.
4. Filling every account for one month-end makes that date chart on the dashboard, and it renders **dashed** if any contributor is still an estimate.
5. The withheld-history note shrinks by exactly the dates that became complete.
6. `npm run backfill:networth` re-run leaves manual entries untouched.
