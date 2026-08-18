import type { Account, AccountType, Transaction } from '@/lib/types'
import { isLiability } from '@/lib/finance/net-worth'
import { trailingMonths } from '@/lib/finance/cashflow'
import { shiftMonth } from '@/lib/finance/month'

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
 *
 * **Reconstruction stops at the account's transaction horizon.** Before the
 * oldest transaction there is nothing left to subtract, so every earlier
 * month-end would return an identical balance — a flat line asserting "net
 * worth did not change" when the truth is "we have no information". Plaid
 * typically returns far less history than the 13-month window, so without this
 * clamp most of the series would be fabricated. Points are therefore emitted
 * only from the last month-end before the oldest transaction onward; that
 * anchor is the account's opening position and is exactly as well-supported as
 * the points after it. An account with no transactions at all reconstructs to
 * nothing.
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
  if (inWindow.length === 0) return []

  const oldestTxn = inWindow.reduce((min, t) => (t.date < min ? t.date : min), inWindow[0].date)
  // Keep the last month-end before the oldest transaction as the opening
  // anchor, then everything after it. Earlier ends carry no information.
  const firstInformed = ends.findIndex((end) => end >= oldestTxn)
  const startIdx =
    firstInformed === -1
      ? ends.length - 1 // every end predates the oldest txn: only the anchor survives
      : Math.max(0, firstInformed - 1)

  const sign = isLiability(accountType) ? 1 : -1

  return ends.slice(startIdx).map((as_of) => {
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
  /**
   * False when fewer accounts contributed snapshots to this date than to the
   * fullest date in the series — the date's net worth is missing at least one
   * account and is therefore not comparable to a complete one.
   */
  complete: boolean
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
 *
 * **Completeness.** Summing whatever rows a date happens to have silently omits
 * accounts that had no snapshot yet. Connect a credit card on day 22 and days
 * 1–21 hold checking only: comparing day 1 to day 30 would read the newly
 * linked account's whole balance as a gain the user never made, and a
 * re-run backfill dropping month-end rows for the new account inside an
 * otherwise-daily observed range would render as a sawtooth. So each date
 * records which accounts contributed, and any date with fewer contributors
 * than the fullest date in the series is marked `complete: false`. Consumers
 * exclude those points; nothing here guesses a missing balance.
 */
export function netWorthSeries(
  snapshots: BalanceSnapshot[],
  accounts: Account[],
): NetWorthPoint[] {
  const typeById = new Map(accounts.map((a) => [a.id, a.type]))
  const byDate = new Map<
    string,
    { net_worth: number; source: SnapshotSource; accountIds: Set<string> }
  >()

  for (const s of snapshots) {
    const type = typeById.get(s.account_id)
    if (!type) continue
    const signed = isLiability(type) ? -s.balance : s.balance
    const entry =
      byDate.get(s.as_of) ??
      { net_worth: 0, source: 'observed' as SnapshotSource, accountIds: new Set<string>() }
    entry.net_worth += signed
    entry.accountIds.add(s.account_id)
    if (s.source === 'reconstructed') entry.source = 'reconstructed'
    byDate.set(s.as_of, entry)
  }

  const widest = Math.max(0, ...[...byDate.values()].map((v) => v.accountIds.size))

  return [...byDate.entries()]
    .map(([as_of, v]) => ({
      as_of,
      net_worth: v.net_worth,
      source: v.source,
      complete: v.accountIds.size === widest,
    }))
    .sort((a, b) => a.as_of.localeCompare(b.as_of))
}

/**
 * The points at or after `months` months before the newest point's date.
 *
 * A count-based slice cannot work here: observed points are daily and
 * reconstructed ones are month-end, so any "points per month" heuristic shows
 * a wildly different span depending on how much observed data has accumulated.
 * The cutoff day is clamped to the target month's length so a 31st never
 * rolls forward into the next month.
 *
 * Expects `points` sorted ascending by `as_of` (as `netWorthSeries` returns).
 */
export function sliceTrailingMonths(points: NetWorthPoint[], months: number): NetWorthPoint[] {
  if (points.length === 0) return []
  const newest = points[points.length - 1].as_of
  const targetYm = shiftMonth(newest.slice(0, 7), -months)
  const lastDay = monthEnd(targetYm).slice(8)
  const day = newest.slice(8) <= lastDay ? newest.slice(8) : lastDay
  const cutoff = `${targetYm}-${day}`
  return points.filter((p) => p.as_of >= cutoff)
}

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

/**
 * Change in net worth across the trailing `days` window, computed from OBSERVED,
 * COMPLETE points only. Reconstructed points are excluded by design: they cannot
 * see market moves or interest, so a delta drawn from them would restate
 * cumulative cashflow — the conflation this feature exists to fix. Incomplete
 * points are excluded for the same reason in a different direction: comparing a
 * date that is missing an account against one that has it reports linking an
 * account as a change in wealth.
 *
 * Returns null when fewer than two such points fall in the window. The returned
 * `days` is the true span measured, which may be shorter than requested when
 * collection only started recently.
 *
 * Expects `series` sorted ascending by `as_of` (as `netWorthSeries` returns).
 */
export function netWorthDelta(series: NetWorthPoint[], days: number): NetWorthDelta | null {
  const observed = series.filter((p) => p.source === 'observed' && p.complete)
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

export interface HiddenHistory {
  /** How many dates were withheld. */
  dates: number
  /** Oldest withheld date, 'YYYY-MM-DD'. */
  from: string
  /** Newest withheld date, 'YYYY-MM-DD'. */
  to: string
}

/**
 * Describes the history that exists but cannot be charted, so the UI can say
 * so rather than silently showing a shorter line than the data suggests.
 *
 * Consumers plot `complete` points only (an incomplete date is missing at least
 * one account, so its total is not comparable to a full one). That filter is
 * correct but invisible: reconstruction is built entirely on transactions, so
 * an investment, loan, or any other account Plaid sends no transactions for
 * reconstructs to nothing — and every backfilled month-end is then narrower
 * than the observed dates that cover all accounts. The whole backfill drops out
 * of the chart and the user is left wondering why `npm run backfill:networth`
 * appeared to do nothing.
 *
 * Returns null when nothing is withheld.
 *
 * Expects `series` sorted ascending by `as_of` (as `netWorthSeries` returns).
 */
export function hiddenHistory(series: NetWorthPoint[]): HiddenHistory | null {
  const hidden = series.filter((p) => !p.complete)
  if (hidden.length === 0) return null

  return {
    dates: hidden.length,
    from: hidden[0].as_of,
    to: hidden[hidden.length - 1].as_of,
  }
}
