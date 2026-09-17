import type { Account, Bill, Transaction } from '@/lib/types'
import { normalizeMerchant, type RecurringCandidate } from '@/lib/finance/recurring'
import { nextDueDate } from '@/lib/finance/bill'

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

/** A dated inflow or outflow the forecast expects. */
export interface ForecastEvent {
  date: string // ISO 'YYYY-MM-DD'
  label: string
  amount: number // signed: outflows negative, inflows positive
  kind: 'bill' | 'recurring' | 'income'
}

export interface ForecastPoint {
  date: string
  balance: number
}

export interface ForecastInputs {
  bills: Bill[]
  /** UNTRACKED candidates only — pass `matchCandidates(...).open`. */
  candidates: RecurringCandidate[]
  incomeStreams: IncomeStream[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (isoDate: string, days: number) =>
  iso(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * MS_PER_DAY))

/**
 * Occurrence dates for a stream, stepping `lastDate` forward by its median
 * interval. Only dates strictly after `today` and on or before `end` are
 * returned.
 *
 * Steps as `lastDate + round(k × interval)` rather than by repeatedly adding a
 * rounded interval: a median like 30.5 would otherwise drift half a day per
 * occurrence and land a monthly charge on the wrong side of a month boundary
 * within a year.
 *
 * `k` starts at 1, never 0. `lastDate` is the most recent charge that ALREADY
 * happened — projecting it again would count money that has already moved.
 */
function streamDates(
  lastDate: string,
  intervalDays: number,
  todayIso: string,
  endIso: string,
): string[] {
  if (!(intervalDays > 0)) return []
  const out: string[] = []
  for (let k = 1; ; k++) {
    const date = addDays(lastDate, Math.round(k * intervalDays))
    if (date > endIso) break
    if (date > todayIso) out.push(date)
  }
  return out
}

/**
 * Every inflow and outflow the forecast expects between `today` (exclusive)
 * and `horizonDays` later, ascending by date.
 *
 * Three ways the same money could be counted twice, all closed here:
 *
 * 1. **A bill occurrence already paid.** An occurrence is skipped when
 *    `last_paid_date` is on or after it — the money already moved.
 *    Deliberately NOT `isPaid`, which asks a different question: whether the
 *    cycle that STARTED at the most recent due date is settled. For a bill
 *    due the 25th, paying on 06-25 makes `isPaid` true on 07-19 while the
 *    upcoming 07-25 charge is still owed, so skipping on `isPaid` would drop
 *    a real outflow and make the projected low look safer than it is.
 * 2. **A recurring charge that is also a tracked bill.** Not closed here —
 *    closed by the caller passing `matchCandidates(...).open`, the same
 *    bucket the bills page shows. Dismissed candidates are excluded too:
 *    dismissing means "not recurring", and the forecast must respect that.
 * 3. **An occurrence that already happened.** `streamDates` starts at k = 1
 *    and drops anything on or before `today`.
 *
 * Bills with no anchor month (a quarterly or yearly row missing `due_month`)
 * produce no events. `nextDueDate` returns null there, and a guessed anchor
 * would be a fabricated date.
 */
export function projectEvents(
  { bills, candidates, incomeStreams }: ForecastInputs,
  horizonDays: number,
  today: Date,
): ForecastEvent[] {
  const todayIso = iso(today)
  const endIso = addDays(todayIso, horizonDays)
  const events: ForecastEvent[] = []

  for (const b of bills) {
    let cursor = today
    while (true) {
      const due = nextDueDate(b, cursor)
      if (!due) break
      const dueIso = iso(due)
      if (dueIso > endIso) break
      const settled = b.last_paid_date != null && b.last_paid_date >= dueIso
      if (!settled) {
        events.push({ date: dueIso, label: b.name, amount: -b.amount, kind: 'bill' })
      }
      cursor = new Date(due.getTime() + MS_PER_DAY)
    }
  }

  for (const c of candidates) {
    for (const date of streamDates(c.lastDate, c.medianIntervalDays, todayIso, endIso)) {
      events.push({ date, label: c.displayName, amount: -c.amount, kind: 'recurring' })
    }
  }

  for (const s of incomeStreams) {
    for (const date of streamDates(s.lastDate, s.medianIntervalDays, todayIso, endIso)) {
      events.push({ date, label: s.displayName, amount: s.amount, kind: 'income' })
    }
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/**
 * The balance after each event, in order.
 *
 * Returns one point per event and deliberately does NOT prepend the starting
 * balance: `start` is measured, every point here is projected, and keeping
 * them structurally separate stops the caller from rendering the two alike.
 *
 * Expects `events` ascending (as `projectEvents` returns).
 */
export function runningBalance(start: number, events: ForecastEvent[]): ForecastPoint[] {
  let balance = start
  return events.map((e) => {
    balance += e.amount
    return { date: e.date, balance }
  })
}

/**
 * The lowest projected balance and the date it lands on — the question the
 * forecast exists to answer. Ties resolve to the earliest date, because the
 * user needs to know when the squeeze starts, not when it ends.
 *
 * Returns null when nothing is projected.
 */
export function forecastLow(points: ForecastPoint[]): { balance: number; date: string } | null {
  if (points.length === 0) return null
  let low = points[0]
  for (const p of points) if (p.balance < low.balance) low = p
  return { balance: low.balance, date: low.date }
}
