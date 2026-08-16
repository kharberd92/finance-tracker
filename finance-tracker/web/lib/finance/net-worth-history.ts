import type { Account, AccountType, Transaction } from '@/lib/types'
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
export interface NetWorthRun {
  source: SnapshotSource
  indices: number[]
}

/**
 * Splits a net worth series into contiguous same-source runs for rendering
 * as separate polylines (solid for observed, dashed for reconstructed).
 *
 * `netWorthSeries` merges snapshots per-date across accounts and marks a
 * date reconstructed if ANY contributing account's snapshot is — it does
 * NOT guarantee reconstructed dates all sort before observed ones. A
 * staggered account-connection scenario (a newly-linked account gets
 * backfilled while an existing account has weeks of observed history) can
 * produce a reconstructed date interleaved after already-observed dates.
 * Splitting on a single boundary index would then mis-render genuinely
 * observed points as part of the dashed run. Grouping by contiguous runs
 * of the point's own `source` avoids that regardless of ordering.
 *
 * Each run after the first repeats the last index of the previous run so
 * adjacent runs share a coordinate and the rendered lines meet without a
 * gap. Indices refer to positions in the original `points` array, so
 * callers can map them straight back to x-coordinates.
 */
export function netWorthRuns(points: NetWorthPoint[]): NetWorthRun[] {
  const runs: NetWorthRun[] = []
  points.forEach((p, i) => {
    const last = runs[runs.length - 1]
    if (last && last.source === p.source) {
      last.indices.push(i)
    } else {
      runs.push({ source: p.source, indices: i > 0 ? [i - 1, i] : [i] })
    }
  })
  return runs
}

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
