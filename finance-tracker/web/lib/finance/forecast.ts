import type { Account, Transaction } from '@/lib/types'
import { normalizeMerchant } from '@/lib/finance/recurring'

/** Account types whose balance is cash the user can actually spend. */
const SPENDABLE_TYPES: Account['type'][] = ['checking', 'savings']

/**
 * Cash available to spend: checking + savings only.
 *
 * Deliberately NOT `netWorth()`, which sums every account through
 * `isLiability`. The forecast answers "how low does my cash get before the
 * next paycheck", and two account types would wreck that question:
 *
 * - **investment** — a 401k cannot be spent on rent. Counting it produces a
 *   forecast that never dips, which is worse than no forecast.
 * - **credit** — a card balance is debt, not a resource. Subtracting it would
 *   answer a net-worth question, and would double-count as soon as the card
 *   payment itself projects as a bill.
 *
 * The consequence is that card spending does not reduce projected cash until
 * its payment lands, so the curve runs optimistic for a card-heavy month. The
 * UI states that rather than modelling statement cycles.
 */
export function spendableCash(accounts: Account[]): number {
  return accounts
    .filter((a) => SPENDABLE_TYPES.includes(a.type))
    .reduce((sum, a) => sum + a.current_balance, 0)
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WINDOW_MONTHS = 13

/** Minimum occurrences before a stream is regular enough to project from. */
const MIN_OCCURRENCES = 3
/** Every gap must sit within this fraction of the median gap. */
const INTERVAL_TOLERANCE = 0.2
/** Every amount must sit within this fraction of the median amount. */
const AMOUNT_TOLERANCE = 0.3

const toCents = (n: number) => Math.round(n * 100) / 100

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** A regularly recurring inflow, projected by interval rather than by cadence name. */
export interface IncomeStream {
  merchantKey: string // normalized key, shared with the expense detector
  displayName: string // most recent raw merchant_name
  amount: number // median magnitude, rounded to cents
  medianIntervalDays: number
  lastDate: string // ISO 'YYYY-MM-DD' of the most recent occurrence
  occurrences: number
}

/**
 * Detects regularly recurring income in the trailing 13 months before `today`.
 *
 * Deliberately **not** `detectRecurring` with the sign flipped. That detector
 * classifies into `BillFrequency` bands — weekly 5–9 days, monthly 28–33 —
 * and the two most common US pay cadences fall straight through them:
 * biweekly is 14 days and semi-monthly is about 15. Naming the cadence would
 * mean either missing most paychecks or adding a `BillFrequency` value that
 * ripples into the bills table, its forms, and `monthlyEquivalent`.
 *
 * Forecasting never needs the name — it needs the next dates. So a stream
 * carries its raw median interval and nothing classifies it.
 *
 * The regularity guards match the expense detector's on purpose: same ±20%
 * interval and ±30% amount tolerances, so "regular enough to project" means
 * one thing across the app.
 *
 * `Transfer` is excluded — moving money between your own accounts is not
 * income, and counting it would inflate every projection by the size of the
 * user's savings habit.
 */
export function detectIncomeStreams(transactions: Transaction[], today: Date): IncomeStream[] {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - WINDOW_MONTHS, today.getUTCDate()),
  )
  const startIso = start.toISOString().slice(0, 10)

  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.amount <= 0) continue
    if (t.category === 'Transfer') continue
    if (t.date < startIso) continue
    const key = normalizeMerchant(t.merchant_name)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }

  const out: IncomeStream[] = []
  for (const [key, txns] of groups) {
    if (txns.length < MIN_OCCURRENCES) continue
    const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1))

    const days = sorted.map((t) => new Date(`${t.date}T00:00:00Z`).getTime() / MS_PER_DAY)
    const intervals: number[] = []
    for (let i = 1; i < days.length; i++) intervals.push(days[i] - days[i - 1])
    const medInterval = median(intervals)
    if (medInterval <= 0) continue
    if (!intervals.every((iv) => Math.abs(iv - medInterval) <= medInterval * INTERVAL_TOLERANCE)) {
      continue
    }

    const amounts = sorted.map((t) => t.amount)
    const medAmount = median(amounts)
    if (!amounts.every((a) => Math.abs(a - medAmount) <= medAmount * AMOUNT_TOLERANCE)) continue

    const last = sorted[sorted.length - 1]
    out.push({
      merchantKey: key,
      displayName: last.merchant_name,
      amount: toCents(medAmount),
      medianIntervalDays: medInterval,
      lastDate: last.date,
      occurrences: sorted.length,
    })
  }

  return out.sort((a, b) => b.amount - a.amount)
}
