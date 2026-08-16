# Net Worth History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give net worth a stored past — daily observed balance snapshots plus a marked 13-month reconstructed backfill — and replace the dashboard's misleading "▲ this month" chip with a real net-worth delta and a trend chart.

**Architecture:** Snapshot **per-account balances** (not aggregate net worth) into a new `account_balance_snapshots` table, so net worth stays computed at query time via the existing liability rule. Pure math lives in `lib/finance/net-worth-history.ts` with `today` injected. Capture is a new per-user pass in the daily sync; backfill is a one-time script. The dashboard's existing chart region gains a Cashflow | Net worth toggle rather than a second full-width chart.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (Postgres + RLS) · Vitest · hand-rolled SVG. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-14-net-worth-history-design.md`

## Global Constraints

- **No new dependencies. No charting library.** The trend chart is hand-rolled SVG, matching `cashflow-chart.tsx`.
- **Pure `lib/finance/` modules import no Supabase and no React.** They are unit-tested in isolation.
- **`today` is always a parameter, never the clock.** Convention set by `lib/finance/recurring.ts`.
- **One definition of "liability".** `reconstructBalances` and `netWorthSeries` import the rule from `lib/finance/net-worth.ts`; they never restate `['credit']`.
- **Reconstructed points never feed the delta figure.** `netWorthDelta` reads observed points only.
- **SVG `<title>` takes exactly one string child** — a single template literal, never interleaved `{}` expressions — or Next 16 throws a hydration mismatch. See `[[svg-title-hydration-gotcha]]`.
- **Next 16 conventions** (`finance-tracker/web/AGENTS.md`): `cookies()` is async; shadcn Button composes via `render`, not `asChild`.
- All commands run from `finance-tracker/web/`.
- Every task ends green: `npx vitest run` passes and `npm run build` succeeds.

---

## File Structure

**Created:**
- `lib/finance/net-worth-history.ts` — all pure history math (Tasks 1, 2)
- `lib/finance/net-worth-history.test.ts` — its unit tests (Tasks 1, 2)
- `supabase/migrations/0009_net_worth_history.sql` — table, RLS, index (Task 3)
- `scripts/backfill-net-worth.ts` — one-time reconstruction script (Task 4)
- `components/dashboard/chart-geometry.ts` — shared viewBox constants + `usd` (Task 5)
- `components/dashboard/cashflow-svg.tsx` — presentational cashflow SVG, extracted (Task 5)
- `components/dashboard/trend-panel.tsx` — Card shell, view toggle, span control (Task 5)
- `components/dashboard/net-worth-svg.tsx` — presentational net worth SVG (Task 6)
- `components/dashboard/net-worth-sparkline.tsx` — small inline sparkline (Task 6)

**Modified:**
- `lib/finance/net-worth.ts` — export `isLiability` (Task 1)
- `lib/types.ts` — add `AccountBalanceSnapshot` (Task 3)
- `lib/plaid/sync-items.ts` — add `snapshotRows` + `captureBalanceSnapshots` (Task 3)
- `scripts/daily-sync.ts` — call the capture pass (Task 3)
- `components/dashboard/cashflow-chart.tsx` — **deleted**, replaced by `trend-panel.tsx` + `cashflow-svg.tsx` (Task 5)
- `app/(app)/page.tsx` — snapshot query, real delta chip, `TrendPanel` (Tasks 5, 6)

---

### Task 1: Pure `reconstructBalances`

The crux of the whole plan. The backwards-walk direction **inverts for liability accounts**, and getting it wrong produces a smooth, plausible, entirely wrong curve.

**Files:**
- Modify: `lib/finance/net-worth.ts`
- Create: `lib/finance/net-worth-history.ts`
- Test: `lib/finance/net-worth-history.test.ts`

**Interfaces:**
- Consumes: `Account`, `AccountType`, `Transaction` from `@/lib/types`; `trailingMonths` from `@/lib/finance/cashflow`.
- Produces: `isLiability(type: AccountType): boolean` (from `net-worth.ts`); `reconstructBalances(currentBalance: number, accountType: AccountType, transactions: Transaction[], months: number, today: string): { as_of: string; balance: number }[]`.

- [ ] **Step 1: Export the liability rule from `net-worth.ts`**

Replace the file body so the rule is shared rather than duplicated:

```ts
import type { Account, AccountType } from '@/lib/types'

const LIABILITY_TYPES: AccountType[] = ['credit']

/** True when an account's balance represents debt owed rather than value held. */
export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type)
}

/** Net worth = sum of asset balances minus sum of liability balances. */
export function netWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) => (isLiability(a.type) ? sum - a.current_balance : sum + a.current_balance),
    0,
  )
}
```

- [ ] **Step 2: Write the failing tests**

Create `lib/finance/net-worth-history.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconstructBalances } from './net-worth-history'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: 'a', amount: -10,
    date: '2026-07-10', merchant_name: 'Store', category: 'Shopping',
    notes: null, is_manual: false, ...partial,
  }
}

describe('reconstructBalances', () => {
  it('returns one month-end point per requested month, newest last', () => {
    const out = reconstructBalances(1000, 'checking', [], 3, '2026-08-14')
    expect(out.map((p) => p.as_of)).toEqual(['2026-06-30', '2026-07-31'])
  })

  it('walks an asset account backwards: a past expense means a higher past balance', () => {
    // $200 spent on Aug 5 (after the Jul 31 month-end).
    const out = reconstructBalances(1000, 'checking', [txn({ amount: -200, date: '2026-08-05' })], 2, '2026-08-14')
    const jul = out.find((p) => p.as_of === '2026-07-31')!
    expect(jul.balance).toBe(1200)
  })

  it('walks a liability account the OPPOSITE way: a past charge means lower past debt', () => {
    // current_balance on a card is positive debt owed; a $200 charge on Aug 5
    // raised it, so debt at Jul 31 was 200 LOWER, not higher.
    const out = reconstructBalances(1000, 'credit', [txn({ amount: -200, date: '2026-08-05' })], 2, '2026-08-14')
    const jul = out.find((p) => p.as_of === '2026-07-31')!
    expect(jul.balance).toBe(800)
  })

  it('treats income on an asset account as a lower past balance', () => {
    const out = reconstructBalances(1000, 'checking', [txn({ amount: 500, date: '2026-08-05' })], 2, '2026-08-14')
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(500)
  })

  it('accumulates across a month boundary', () => {
    const out = reconstructBalances(
      1000,
      'checking',
      [txn({ amount: -100, date: '2026-08-05' }), txn({ amount: -50, date: '2026-07-20' })],
      3,
      '2026-08-14',
    )
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(1100)
    expect(out.find((p) => p.as_of === '2026-06-30')!.balance).toBe(1150)
  })

  it('ignores transactions dated after today', () => {
    const out = reconstructBalances(1000, 'checking', [txn({ amount: -999, date: '2026-09-01' })], 2, '2026-08-14')
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(1000)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/finance/net-worth-history.test.ts`
Expected: FAIL — `Failed to resolve import "./net-worth-history"`.

- [ ] **Step 4: Implement**

Create `lib/finance/net-worth-history.ts`:

```ts
import type { AccountType, Transaction } from '@/lib/types'
import { isLiability } from '@/lib/finance/net-worth'
import { trailingMonths } from '@/lib/finance/cashflow'

/** Last calendar day of a 'YYYY-MM' month, as 'YYYY-MM-DD'. */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)) // day 0 of next month = last day of this one
  return d.toISOString().slice(0, 10)
}

/**
 * Reconstructs an account's past month-end balances by walking today's balance
 * backwards through its transactions.
 *
 * The direction inverts by account type. `current_balance` on a credit account
 * is positive debt owed, while `mapTransaction` stores any outflow as negative:
 *
 *   assets:      balance(d) = current - sum(txns after d)
 *   liabilities: balance(d) = current + sum(txns after d)
 *
 * A $50 expense means a checking balance was $50 higher before it; the same $50
 * card charge means the debt was $50 LOWER before it.
 *
 * Only the current partial month is excluded — the newest point returned is the
 * previous month's end. Results are approximate by nature: transactions cannot
 * explain market moves, interest, or balance-only adjustments, which is why
 * callers must mark these points `source='reconstructed'`.
 */
export function reconstructBalances(
  currentBalance: number,
  accountType: AccountType,
  transactions: Transaction[],
  months: number,
  today: string,
): { as_of: string; balance: number }[] {
  const currentYm = today.slice(0, 7)
  // trailingMonths includes the current (partial) month; drop it — its month-end
  // has not happened yet.
  const ends = trailingMonths(currentYm, months)
    .filter((ym) => ym !== currentYm)
    .map(monthEnd)

  const inWindow = transactions.filter((t) => t.date <= today)
  const sign = isLiability(accountType) ? 1 : -1

  return ends.map((as_of) => {
    const after = inWindow
      .filter((t) => t.date > as_of)
      .reduce((sum, t) => sum + t.amount, 0)
    return { as_of, balance: currentBalance + sign * after }
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/finance/net-worth-history.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: all previously-green tests still pass (`net-worth.ts` changed shape but not behavior); build clean.

- [ ] **Step 7: Commit**

```bash
git add lib/finance/net-worth.ts lib/finance/net-worth-history.ts lib/finance/net-worth-history.test.ts
git commit -m "feat(web): reconstruct past account balances from transaction history"
```

---

### Task 2: Pure `netWorthSeries` and `netWorthDelta`

**Files:**
- Modify: `lib/finance/net-worth-history.ts`
- Test: `lib/finance/net-worth-history.test.ts`

**Interfaces:**
- Consumes: `isLiability` (Task 1); `Account` from `@/lib/types`.
- Produces:
  - `type SnapshotSource = 'observed' | 'reconstructed'`
  - `interface BalanceSnapshot { account_id: string; as_of: string; balance: number; source: SnapshotSource }`
  - `interface NetWorthPoint { as_of: string; net_worth: number; source: SnapshotSource }`
  - `interface NetWorthDelta { change: number; fromDate: string; toDate: string; days: number }`
  - `netWorthSeries(snapshots: BalanceSnapshot[], accounts: Account[]): NetWorthPoint[]`
  - `netWorthDelta(series: NetWorthPoint[], days: number): NetWorthDelta | null`

- [ ] **Step 1: Write the failing tests**

Append to `lib/finance/net-worth-history.test.ts`. **Merge the imports into the existing ones at the top of the file** rather than adding a second `import` from the same module — `no-duplicate-imports` will fail lint. After merging, the file's import block reads:

```ts
import { describe, it, expect } from 'vitest'
import {
  reconstructBalances,
  netWorthSeries,
  netWorthDelta,
  type BalanceSnapshot,
  type NetWorthPoint,
} from './net-worth-history'
import type { Account, Transaction } from '@/lib/types'
```

Then append the new test bodies:

```ts

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'Checking', type: 'checking',
    current_balance: 0, institution_name: 'Bank', ...partial,
  }
}

function snap(partial: Partial<BalanceSnapshot>): BalanceSnapshot {
  return { account_id: 'a', as_of: '2026-08-01', balance: 100, source: 'observed', ...partial }
}

describe('netWorthSeries', () => {
  const accounts = [acct({ id: 'a', type: 'checking' }), acct({ id: 'c', type: 'credit' })]

  it('subtracts liability balances and adds asset balances per date', () => {
    const out = netWorthSeries(
      [
        snap({ account_id: 'a', as_of: '2026-08-01', balance: 1000 }),
        snap({ account_id: 'c', as_of: '2026-08-01', balance: 400 }),
      ],
      accounts,
    )
    expect(out).toEqual([{ as_of: '2026-08-01', net_worth: 600, source: 'observed' }])
  })

  it('sorts points ascending by date', () => {
    const out = netWorthSeries(
      [snap({ as_of: '2026-08-02' }), snap({ as_of: '2026-08-01' })],
      accounts,
    )
    expect(out.map((p) => p.as_of)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('marks a date reconstructed when any contributing snapshot is reconstructed', () => {
    const out = netWorthSeries(
      [
        snap({ account_id: 'a', as_of: '2026-08-01', balance: 1000, source: 'observed' }),
        snap({ account_id: 'c', as_of: '2026-08-01', balance: 400, source: 'reconstructed' }),
      ],
      accounts,
    )
    expect(out[0].source).toBe('reconstructed')
  })

  it('ignores snapshots for accounts that no longer exist', () => {
    const out = netWorthSeries([snap({ account_id: 'gone', balance: 999 })], accounts)
    expect(out).toEqual([])
  })
})

describe('netWorthDelta', () => {
  const obs = (as_of: string, net_worth: number): NetWorthPoint =>
    ({ as_of, net_worth, source: 'observed' })

  it('returns null with fewer than two observed points', () => {
    expect(netWorthDelta([obs('2026-08-10', 100)], 30)).toBeNull()
  })

  it('returns null when the only extra points are reconstructed', () => {
    const series: NetWorthPoint[] = [
      { as_of: '2026-07-31', net_worth: 50, source: 'reconstructed' },
      obs('2026-08-10', 100),
    ]
    expect(netWorthDelta(series, 30)).toBeNull()
  })

  it('measures change between the oldest and newest observed points in the window', () => {
    const out = netWorthDelta([obs('2026-07-20', 800), obs('2026-08-10', 1000)], 30)
    expect(out).toEqual({ change: 200, fromDate: '2026-07-20', toDate: '2026-08-10', days: 21 })
  })

  it('excludes observed points older than the window', () => {
    const out = netWorthDelta([obs('2026-01-01', 1), obs('2026-08-01', 900), obs('2026-08-10', 1000)], 30)
    expect(out!.fromDate).toBe('2026-08-01')
    expect(out!.change).toBe(100)
  })

  it('reports the true span it measured, not the requested one', () => {
    const out = netWorthDelta([obs('2026-08-05', 900), obs('2026-08-10', 1000)], 30)
    expect(out!.days).toBe(5)
  })

  it('reports negative change when net worth fell', () => {
    expect(netWorthDelta([obs('2026-08-01', 1000), obs('2026-08-10', 900)], 30)!.change).toBe(-100)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/finance/net-worth-history.test.ts`
Expected: FAIL — `netWorthSeries is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/finance/net-worth-history.ts`:

```ts
import type { Account } from '@/lib/types'

export type SnapshotSource = 'observed' | 'reconstructed'

export interface BalanceSnapshot {
  account_id: string
  as_of: string
  balance: number
  source: SnapshotSource
}

export interface NetWorthPoint {
  as_of: string
  net_worth: number
  source: SnapshotSource
}

export interface NetWorthDelta {
  change: number
  fromDate: string
  toDate: string
  days: number
}

/** Whole days between two 'YYYY-MM-DD' dates. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * Rolls per-account balance snapshots into a net worth series, applying the
 * same liability rule `netWorth()` uses. A date is marked 'reconstructed' when
 * ANY contributing account balance is reconstructed — a point is only as
 * trustworthy as its weakest input.
 *
 * Snapshots for accounts that no longer exist are dropped: their type is
 * unknown, so their sign would be a guess.
 */
export function netWorthSeries(
  snapshots: BalanceSnapshot[],
  accounts: Account[],
): NetWorthPoint[] {
  const typeById = new Map(accounts.map((a) => [a.id, a.type]))
  const byDate = new Map<string, { net_worth: number; source: SnapshotSource }>()

  for (const s of snapshots) {
    const type = typeById.get(s.account_id)
    if (!type) continue
    const signed = isLiability(type) ? -s.balance : s.balance
    const entry = byDate.get(s.as_of) ?? { net_worth: 0, source: 'observed' as SnapshotSource }
    entry.net_worth += signed
    if (s.source === 'reconstructed') entry.source = 'reconstructed'
    byDate.set(s.as_of, entry)
  }

  return [...byDate.entries()]
    .map(([as_of, v]) => ({ as_of, ...v }))
    .sort((a, b) => a.as_of.localeCompare(b.as_of))
}

/**
 * Change in net worth across the trailing `days` window, computed from OBSERVED
 * points only. Reconstructed points are excluded by design: they cannot see
 * market moves or interest, so a delta drawn from them would restate cumulative
 * cashflow — the conflation this feature exists to fix.
 *
 * Returns null when fewer than two observed points fall in the window. The
 * returned `days` is the true span measured, which may be shorter than
 * requested when collection only started recently.
 */
export function netWorthDelta(series: NetWorthPoint[], days: number): NetWorthDelta | null {
  const observed = series.filter((p) => p.source === 'observed')
  if (observed.length < 2) return null

  const latest = observed[observed.length - 1]
  const cutoff = observed.filter((p) => daysBetween(p.as_of, latest.as_of) <= days)
  if (cutoff.length < 2) return null

  const earliest = cutoff[0]
  return {
    change: latest.net_worth - earliest.net_worth,
    fromDate: earliest.as_of,
    toDate: latest.as_of,
    days: daysBetween(earliest.as_of, latest.as_of),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/finance/net-worth-history.test.ts`
Expected: PASS, 16 tests total across both describes.

- [ ] **Step 5: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add lib/finance/net-worth-history.ts lib/finance/net-worth-history.test.ts
git commit -m "feat(web): roll balance snapshots into a net worth series and delta"
```

---

### Task 3: Schema and daily capture

**Files:**
- Create: `supabase/migrations/0009_net_worth_history.sql`
- Modify: `lib/types.ts`, `lib/plaid/sync-items.ts`, `scripts/daily-sync.ts`
- Test: `lib/plaid/sync-items.test.ts` — **this file already exists** with `syncPlaidItems` tests. Append to it; do not overwrite.

**Interfaces:**
- Consumes: `Account` from `@/lib/types`.
- Produces: `snapshotRows(accounts: Account[], asOf: string): AccountBalanceSnapshotRow[]`; `captureBalanceSnapshots(db: SupabaseClient, asOf: string): Promise<number>`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_net_worth_history.sql`:

```sql
-- Net worth history: per-account balance snapshots. Net worth stays computed
-- at query time from these rows, so the liability rule can change without
-- invalidating stored history.
create table if not exists account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  as_of date not null,
  balance numeric not null,
  source text not null check (source in ('observed', 'reconstructed')),
  created_at timestamptz not null default now(),
  unique (account_id, as_of)
);

-- Every read is "this user's series over a date range".
create index if not exists account_balance_snapshots_user_date
  on account_balance_snapshots (user_id, as_of);

alter table account_balance_snapshots enable row level security;

create policy account_balance_snapshots_owner on account_balance_snapshots
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Add the row type**

Append to `lib/types.ts`:

```ts
export interface AccountBalanceSnapshot {
  id: string
  user_id: string
  account_id: string
  as_of: string // ISO 'YYYY-MM-DD'
  balance: number
  source: 'observed' | 'reconstructed'
}
```

- [ ] **Step 3: Write the failing test**

`lib/plaid/sync-items.test.ts` already exists and imports `{ describe, it, expect, vi, beforeEach }` from vitest, `{ syncPlaidItems }` from `./sync-items`, and `type { PlaidItem }` from `@/lib/types`. **Extend those existing import lines** — add `snapshotRows` to the `./sync-items` import and `Account` to the types import — then append the new describe block:

```ts
// added to the existing imports:
//   import { syncPlaidItems, snapshotRows } from './sync-items'
//   import type { PlaidItem, Account } from '@/lib/types'

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'Checking', type: 'checking',
    current_balance: 100, institution_name: 'Bank', ...partial,
  }
}

describe('snapshotRows', () => {
  it('builds one observed row per account at the given date', () => {
    const rows = snapshotRows([acct({ id: 'a', current_balance: 100 })], '2026-08-14')
    expect(rows).toEqual([
      { user_id: 'u', account_id: 'a', as_of: '2026-08-14', balance: 100, source: 'observed' },
    ])
  })

  it('includes manual (non-Plaid) accounts', () => {
    const rows = snapshotRows([acct({ id: 'm', plaid_account_id: null })], '2026-08-14')
    expect(rows).toHaveLength(1)
  })

  it('returns an empty array for no accounts', () => {
    expect(snapshotRows([], '2026-08-14')).toEqual([])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/plaid/sync-items.test.ts`
Expected: FAIL — `snapshotRows is not exported`.

- [ ] **Step 5: Implement capture**

Append to `lib/plaid/sync-items.ts`:

```ts
import type { Account } from '@/lib/types'

export type AccountBalanceSnapshotRow = {
  user_id: string
  account_id: string
  as_of: string
  balance: number
  source: 'observed'
}

/** Pure: maps accounts to the snapshot rows recorded for a given date. */
export function snapshotRows(accounts: Account[], asOf: string): AccountBalanceSnapshotRow[] {
  return accounts.map((a) => ({
    user_id: a.user_id,
    account_id: a.id,
    as_of: asOf,
    balance: a.current_balance,
    source: 'observed' as const,
  }))
}

/**
 * Records one balance snapshot per account for `asOf`, across ALL accounts —
 * not just Plaid-linked ones. Manual accounts hold balances too, and omitting
 * them would silently skew every point in the net worth series.
 *
 * Upserts on (account_id, as_of), so running twice in a day rewrites the day
 * rather than duplicating it. Returns the number of rows written.
 */
export async function captureBalanceSnapshots(
  db: SupabaseClient,
  asOf: string,
): Promise<number> {
  const { data, error } = await db.from('accounts').select('*')
  if (error) throw new Error(`Failed to load accounts for snapshot: ${error.message}`)

  const rows = snapshotRows((data ?? []) as Account[], asOf)
  if (rows.length === 0) return 0

  const { error: upsertError } = await db
    .from('account_balance_snapshots')
    .upsert(rows, { onConflict: 'account_id,as_of' })
  if (upsertError) throw new Error(`Failed to write snapshots: ${upsertError.message}`)

  return rows.length
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/plaid/sync-items.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Wire capture into the daily sync**

In `scripts/daily-sync.ts`, change the import line to include the new function and add the capture pass after `syncPlaidItems` returns:

```ts
import { syncPlaidItems, captureBalanceSnapshots } from '@/lib/plaid/sync-items'
```

Then, immediately after the existing `const result = await syncPlaidItems(...)` line:

```ts
  // Snapshot AFTER syncing so balances are fresh. Runs over all accounts, not
  // just the synced items — manual accounts count toward net worth too.
  const asOf = new Date().toISOString().slice(0, 10)
  try {
    const written = await captureBalanceSnapshots(db, asOf)
    console.log(`[daily-sync] balance snapshots written: ${written} for ${asOf}`)
  } catch (err) {
    // A snapshot failure must not mask a successful transaction sync.
    console.error(`[daily-sync] snapshot failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
```

- [ ] **Step 8: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0009_net_worth_history.sql lib/types.ts lib/plaid/sync-items.ts lib/plaid/sync-items.test.ts scripts/daily-sync.ts
git commit -m "feat(web): snapshot account balances daily for net worth history"
```

---

### Task 4: Backfill script

**Files:**
- Create: `scripts/backfill-net-worth.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `reconstructBalances` (Task 1); `createAdminClient` from `@/lib/supabase/admin`; `AccountBalanceSnapshot` (Task 3).
- Produces: `npm run backfill:networth` — a one-time, idempotent script.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-net-worth.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { reconstructBalances } from '@/lib/finance/net-worth-history'
import type { Account, Transaction } from '@/lib/types'

const MONTHS = 13 // matches the recurring detector's window; gives a YoY read

/**
 * One-time backfill: reconstructs 13 months of month-end balances from
 * transaction history and writes them as source='reconstructed'.
 *
 * Idempotent and non-destructive. Upserts on (account_id, as_of), and skips any
 * date at or after an account's first OBSERVED snapshot so real data is never
 * overwritten by an estimate.
 */
async function main() {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: accountData, error: accountError } = await db.from('accounts').select('*')
  if (accountError) throw new Error(`Failed to load accounts: ${accountError.message}`)
  const accounts = (accountData ?? []) as Account[]

  const { data: txnData, error: txnError } = await db.from('transactions').select('*')
  if (txnError) throw new Error(`Failed to load transactions: ${txnError.message}`)
  const transactions = (txnData ?? []) as Transaction[]

  // Earliest observed snapshot per account — the boundary estimates must not cross.
  const { data: observedData, error: observedError } = await db
    .from('account_balance_snapshots')
    .select('account_id, as_of')
    .eq('source', 'observed')
    .order('as_of', { ascending: true })
  if (observedError) throw new Error(`Failed to load observed snapshots: ${observedError.message}`)

  const firstObserved = new Map<string, string>()
  for (const row of (observedData ?? []) as { account_id: string; as_of: string }[]) {
    if (!firstObserved.has(row.account_id)) firstObserved.set(row.account_id, row.as_of)
  }

  let written = 0
  let skipped = 0

  for (const account of accounts) {
    const mine = transactions.filter((t) => t.account_id === account.id)
    const points = reconstructBalances(
      account.current_balance,
      account.type,
      mine,
      MONTHS,
      today,
    )

    const boundary = firstObserved.get(account.id)
    const eligible = boundary ? points.filter((p) => p.as_of < boundary) : points
    skipped += points.length - eligible.length
    if (eligible.length === 0) continue

    const rows = eligible.map((p) => ({
      user_id: account.user_id,
      account_id: account.id,
      as_of: p.as_of,
      balance: p.balance,
      source: 'reconstructed' as const,
    }))

    const { error } = await db
      .from('account_balance_snapshots')
      .upsert(rows, { onConflict: 'account_id,as_of' })
    if (error) throw new Error(`Failed to write backfill for ${account.name}: ${error.message}`)

    written += rows.length
    console.log(`[backfill] ${account.name}: ${rows.length} reconstructed points`)
  }

  console.log(`[backfill] done — ${written} rows written, ${skipped} skipped (observed data wins)`)
}

main().catch((err) => {
  console.error(`[backfill] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
```

- [ ] **Step 2: Add the npm script**

In `package.json`, alongside `sync:daily` and `dev:login`:

```json
"backfill:networth": "node --env-file=.env.local --import tsx scripts/backfill-net-worth.ts"
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean. (Do not run the script itself until migration `0009` is applied — see Post-Implementation.)

- [ ] **Step 4: Run the full suite and build**

Run: `npx vitest run && npm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-net-worth.ts package.json
git commit -m "feat(web): add one-time net worth backfill script"
```

---

### Task 5: Extract the cashflow SVG and introduce `TrendPanel`

Pure refactor — no behavior change. The dashboard must look and behave identically when this task ends. Splitting it out means Task 6 adds a view rather than rewriting a chart.

**Files:**
- Create: `components/dashboard/chart-geometry.ts`, `components/dashboard/cashflow-svg.tsx`, `components/dashboard/trend-panel.tsx`
- Delete: `components/dashboard/cashflow-chart.tsx`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `CashflowMonth`, `cashflowDomain` from `@/lib/finance/cashflow`.
- Produces: the `chart-geometry` constants below; `CashflowSvg({ rows }: { rows: CashflowMonth[] })`; `TrendPanel({ cashflow }: { cashflow: CashflowMonth[] })`.

- [ ] **Step 1: Create the shared chart geometry module**

Both charts swap into the same panel at the same size, so they must share one
coordinate system — duplicated constants would let them silently drift apart.

Create `components/dashboard/chart-geometry.ts`:

```ts
/**
 * Shared coordinate system for the dashboard trend charts. The cashflow and
 * net worth SVGs render into the same panel slot, so they must agree on the
 * viewBox and plot band exactly — these values are defined once, here.
 */
export const VB_W = 760
export const VB_H = 185
export const PAD = 20
export const PLOT_TOP = 15
export const PLOT_H = 125 // zero line lands at y=140 when the domain minimum is 0
export const LABEL_Y = 166

/** Gridline positions as fractions of the plot band, top to bottom. */
export const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

export const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
```

- [ ] **Step 2: Create the presentational SVG**

Create `components/dashboard/cashflow-svg.tsx`. Move the whole `<svg>…</svg>` body out of `cashflow-chart.tsx` verbatim. Geometry constants (`VB_W`, `VB_H`, `PAD`, `PLOT_TOP`, `PLOT_H`, `LABEL_Y`), `usd`, and the gridline fractions now come from `chart-geometry` — **do not redeclare them here**. The cashflow-only constants (`BAR_W`, `BAR_GAP`, `MONTH_ABBR`) and the `monthLabel` helper stay local to this file, since the net worth chart has no bars or month labels. Replace the local `gridFractions` array with the imported `GRID_FRACTIONS`.

The component takes already-sliced rows and renders only the SVG — no Card, no span control:

```tsx
'use client'

import { cashflowDomain, type CashflowMonth } from '@/lib/finance/cashflow'
import {
  VB_W, VB_H, PAD, PLOT_TOP, PLOT_H, LABEL_Y, GRID_FRACTIONS, usd,
} from '@/components/dashboard/chart-geometry'

const BAR_W = 22
const BAR_GAP = 6
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.slice(5)) - 1] ?? ym
}

export function CashflowSvg({ rows }: { rows: CashflowMonth[] }) {
  // ...domain/scale math moved verbatim, operating on `rows`...
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Monthly income, expense, and net cashflow"
    >
      {/* ...body moved verbatim... */}
    </svg>
  )
}
```

- [ ] **Step 3: Create the panel shell**

Create `components/dashboard/trend-panel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { CashflowSvg } from '@/components/dashboard/cashflow-svg'
import type { CashflowMonth } from '@/lib/finance/cashflow'

const SPANS = [6, 12] as const

export function TrendPanel({ cashflow }: { cashflow: CashflowMonth[] }) {
  const [span, setSpan] = useState<6 | 12>(6)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 text-xs">
          {SPANS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                span === s ? 'bg-accent-soft text-accent-soft-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {s}M
            </button>
          ))}
        </div>
      </div>

      <CashflowSvg rows={cashflow.slice(-span)} />
    </Card>
  )
}
```

- [ ] **Step 4: Swap the dashboard over**

In `app/(app)/page.tsx`, replace the `CashflowChart` import with `TrendPanel`:

```tsx
import { TrendPanel } from '@/components/dashboard/trend-panel'
```

and replace the usage:

```tsx
      <TrendPanel cashflow={rows} />
```

- [ ] **Step 5: Delete the old component**

```bash
git rm components/dashboard/cashflow-chart.tsx
```

- [ ] **Step 6: Verify no behavior changed**

Run: `npx vitest run && npm run build && npx tsc --noEmit`
Expected: all green, no references to `cashflow-chart` remain.

Run: `grep -rn "cashflow-chart" app components lib`
Expected: no matches.

Then start `npm run dev` and confirm the dashboard chart renders identically — same bars, same 6M/12M toggle behavior.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(web): split the cashflow chart into an SVG and a panel shell"
```

---

### Task 6: Net worth view, delta chip, and sparkline

**Files:**
- Create: `components/dashboard/net-worth-svg.tsx`, `components/dashboard/net-worth-sparkline.tsx`
- Modify: `components/dashboard/trend-panel.tsx`, `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `NetWorthPoint`, `NetWorthDelta`, `netWorthSeries`, `netWorthDelta` (Task 2); `AccountBalanceSnapshot` (Task 3).
- Produces: `NetWorthSvg({ points }: { points: NetWorthPoint[] })`; `NetWorthSparkline({ points }: { points: NetWorthPoint[] })`.

- [ ] **Step 1: Build the net worth SVG**

Create `components/dashboard/net-worth-svg.tsx`. Reconstructed and observed segments draw as two separate polylines so the dashed run is visually distinct, and they share the point at the handoff so the line is continuous:

Geometry and `usd` come from the shared `chart-geometry` module created in Task 5 — **do not redeclare them**. The two charts occupy the same panel slot and must agree on the coordinate system exactly.

```tsx
'use client'

import type { NetWorthPoint } from '@/lib/finance/net-worth-history'
import {
  VB_W, VB_H, PAD, PLOT_TOP, PLOT_H, LABEL_Y, GRID_FRACTIONS, usd,
} from '@/components/dashboard/chart-geometry'

export function NetWorthSvg({ points }: { points: NetWorthPoint[] }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No net worth history yet.</p>
  }

  const values = points.map((p) => p.net_worth)
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const y = (v: number) => PLOT_TOP + ((max - v) / range) * PLOT_H
  const slotW = (VB_W - PAD * 2) / Math.max(points.length - 1, 1)
  const x = (i: number) => PAD + slotW * i

  // Split at the LAST reconstructed point; it is shared by both polylines so
  // the dashed and solid runs meet rather than leaving a gap.
  const lastRecon = points.reduce((acc, p, i) => (p.source === 'reconstructed' ? i : acc), -1)
  const pt = (p: NetWorthPoint, i: number) => `${x(i)},${y(p.net_worth)}`
  const reconPoints = lastRecon >= 0 ? points.slice(0, lastRecon + 1).map(pt).join(' ') : ''
  const obsPoints = points.slice(Math.max(lastRecon, 0)).map((p, i) => pt(p, i + Math.max(lastRecon, 0))).join(' ')

  const latest = points[points.length - 1]
  // One string child only — interleaved expressions break hydration in Next 16.
  const caption = `Net worth ${usd(latest.net_worth)} as of ${latest.as_of}`

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Net worth over time"
      >
        <title>{caption}</title>
        {GRID_FRACTIONS.map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={VB_W - PAD}
            y1={PLOT_TOP + f * PLOT_H}
            y2={PLOT_TOP + f * PLOT_H}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        {reconPoints && (
          <polyline
            points={reconPoints}
            fill="none"
            strokeDasharray="5 4"
            strokeWidth={2}
            className="stroke-muted-foreground"
          />
        )}
        <polyline points={obsPoints} fill="none" strokeWidth={2} className="stroke-net" />
        <text x={PAD} y={LABEL_Y} className="fill-muted-foreground text-[11px]">
          {points[0].as_of}
        </text>
        <text x={VB_W - PAD} y={LABEL_Y} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {latest.as_of}
        </text>
      </svg>

      {lastRecon >= 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="mr-1 inline-block h-px w-4 border-t border-dashed border-muted-foreground align-middle" />
          Dashed points are estimated from transaction history, not recorded balances.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the view toggle to `TrendPanel`**

Modify `components/dashboard/trend-panel.tsx` so it accepts net worth points and switches views. The net worth option is omitted entirely when there is no history:

```tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { CashflowSvg } from '@/components/dashboard/cashflow-svg'
import { NetWorthSvg } from '@/components/dashboard/net-worth-svg'
import type { CashflowMonth } from '@/lib/finance/cashflow'
import type { NetWorthPoint } from '@/lib/finance/net-worth-history'

const SPANS = [6, 12] as const
type View = 'cashflow' | 'networth'

export function TrendPanel({
  cashflow,
  netWorth,
}: {
  cashflow: CashflowMonth[]
  netWorth: NetWorthPoint[]
}) {
  const [span, setSpan] = useState<6 | 12>(6)
  const [view, setView] = useState<View>('cashflow')
  const hasHistory = netWorth.length > 0

  // Approximate a month as 30 days for the span filter — points are month-end
  // for reconstructed data and daily for observed, so an exact month count
  // would cut the two sources differently.
  const cutoffIndex = Math.max(0, netWorth.length - span * 2)
  const shownNetWorth = netWorth.slice(cutoffIndex)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        {hasHistory ? (
          <div className="flex gap-1 text-xs">
            {(['cashflow', 'networth'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  view === v ? 'bg-accent-soft text-accent-soft-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {v === 'cashflow' ? 'Cashflow' : 'Net worth'}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Cashflow</span>
        )}

        <div className="flex gap-1 text-xs">
          {SPANS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                span === s ? 'bg-accent-soft text-accent-soft-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {s}M
            </button>
          ))}
        </div>
      </div>

      {view === 'cashflow' || !hasHistory ? (
        <CashflowSvg rows={cashflow.slice(-span)} />
      ) : (
        <NetWorthSvg points={shownNetWorth} />
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Build the sparkline**

Create `components/dashboard/net-worth-sparkline.tsx`:

```tsx
import type { NetWorthPoint } from '@/lib/finance/net-worth-history'

const W = 120
const H = 28

/** Tiny inline trend line for the Net worth card. Renders nothing below 2 points. */
export function NetWorthSparkline({ points }: { points: NetWorthPoint[] }) {
  if (points.length < 2) return null

  const values = points.map((p) => p.net_worth)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = W / (points.length - 1)
  const path = points
    .map((p, i) => `${i * step},${H - ((p.net_worth - min) / range) * H}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={path} fill="none" strokeWidth={1.5} className="stroke-net" />
    </svg>
  )
}
```

- [ ] **Step 4: Wire the dashboard**

In `app/(app)/page.tsx`:

Add imports:

```tsx
import { netWorthSeries, netWorthDelta } from '@/lib/finance/net-worth-history'
import { NetWorthSparkline } from '@/components/dashboard/net-worth-sparkline'
import type { AccountBalanceSnapshot } from '@/lib/types'
```

Add a sixth query to the existing `Promise.all` array:

```tsx
    supabase
      .from('account_balance_snapshots')
      .select('*')
      .gte('as_of', windowStart)
      .order('as_of', { ascending: true }),
```

and receive it by extending the destructure to `[accountsRes, txnsRes, budgetsRes, billsRes, goalsRes, snapshotsRes]`.

Then replace the misleading chip computation. Delete these three lines:

```tsx
  const lastNet = rows[rows.length - 1]?.net ?? 0
  const netLabel =
    lastNet >= 0 ? `▲ this month +${usd(lastNet)}` : `▼ this month ${usd(Math.abs(lastNet))}`
```

and put in their place:

```tsx
  const snapshots = (snapshotsRes.data ?? []) as AccountBalanceSnapshot[]
  const nwSeries = netWorthSeries(snapshots, accounts)
  const delta = netWorthDelta(nwSeries, 30)
  const firstObserved = nwSeries.find((p) => p.source === 'observed')?.as_of
```

Replace the chip `<span>` in the Net worth card with:

```tsx
          {delta ? (
            <span
              className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                delta.change >= 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense'
              }`}
            >
              {delta.change >= 0
                ? `▲ past ${delta.days} days +${usd(delta.change)}`
                : `▼ past ${delta.days} days ${usd(Math.abs(delta.change))}`}
            </span>
          ) : firstObserved ? (
            <span className="mt-2 inline-block text-xs text-muted-foreground">
              {`collecting since ${firstObserved}`}
            </span>
          ) : null}

          <NetWorthSparkline points={nwSeries} />
```

Finally pass the series to the panel:

```tsx
      <TrendPanel cashflow={rows} netWorth={nwSeries} />
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): show real net worth delta, sparkline, and trend chart"
```

---

## Post-Implementation (manual, requires the user)

These cannot be done by an agent — they need the Supabase dashboard and real data.

- [ ] **Apply migration `0009_net_worth_history.sql`** to the Supabase project (dashboard SQL editor or `supabase db push`). Nothing below works until this lands.
- [ ] **Run the backfill once:** `npm run backfill:networth`. Expect one line per account plus a summary. It is safe to re-run.
- [ ] **Run a capture manually to prove the daily path:** `npm run sync:daily`. Expect `balance snapshots written: N for YYYY-MM-DD`.
- [ ] **Manual smoke test** on `/`:
  1. The Net worth card shows `collecting since <date>` (only one observed point exists after a single sync) — **not** a fabricated delta.
  2. The chart region shows a **Cashflow | Net worth** toggle; switching to Net worth renders a line with a **dashed** older segment and a solid recent one.
  3. The dashed-segment legend appears below the chart.
  4. The 6M/12M control still works in both views.
  5. Re-run `npm run sync:daily` — no duplicate rows appear (`select count(*) from account_balance_snapshots where as_of = current_date` stays equal to the account count).
  6. After a second day's capture, the chip switches from `collecting since` to a real `▲ past N days` figure.

---

## Self-Review

**Spec coverage:** Storage model → Task 3. Forward capture over all accounts → Task 3. Backfill with observed-wins boundary → Task 4. Pure logic with `today` injected → Tasks 1–2. Liability sign inversion → Task 1 (with its own test). Delta from observed only → Task 2. 30-day chip with true span → Tasks 2, 6. Trend in the existing chart region → Tasks 5–6. Reconstructed rendered distinctly with a legend → Task 6. Empty states → Task 6 (`hasHistory` gate, `NetWorthSvg` early return, `NetWorthSparkline` null below 2 points). Cascade delete → Task 3 migration. Idempotent capture → Task 3 unique constraint. Testing → Tasks 1–3.

**Out-of-scope items confirmed absent:** no history page, no daily backfill, no interpolation, no per-account breakdown, no retention policy, no restyling.

**Fixed during review:** Task 2's test block imported `./net-worth-history` a second time (lint failure) and used `NetWorthPoint` without importing it (type error) — both now merged into one import block. Task 3 claimed to *create* `lib/plaid/sync-items.test.ts`, which already exists with `syncPlaidItems` tests; it now says append and names the existing imports to extend. Task 5's `git rm` used a repo-root path in a task whose commands run from `finance-tracker/web/`.

**Type consistency:** `BalanceSnapshot` (pure, Task 2) and `AccountBalanceSnapshot` (DB row, Task 3) are deliberately distinct — the DB row carries `id`/`user_id`, and `netWorthSeries` accepts the wider row structurally since it reads only `account_id`, `as_of`, `balance`, `source`. `snapshotRows` returns `AccountBalanceSnapshotRow` (insert shape, no `id`). `NetWorthPoint` is used identically in Tasks 2, 5, and 6. `isLiability` is defined once in Task 1 and imported thereafter.
