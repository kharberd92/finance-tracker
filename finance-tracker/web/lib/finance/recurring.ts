import type { BillFrequency, Transaction, Bill } from '@/lib/types'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { monthlyEquivalent } from '@/lib/finance/bill'

/** A detected recurring charge, carrying everything needed to prefill a bill. */
export interface RecurringCandidate {
  merchantKey: string // normalized key — identity for matching and dismissal
  displayName: string // most recent raw merchant_name
  frequency: BillFrequency
  amount: number // median magnitude, rounded to cents
  occurrences: number
  lastDate: string // ISO 'YYYY-MM-DD' of the most recent occurrence
  dueDayGuess: number // weekly: day-of-week (Sun=0) of lastDate; others: day-of-month
  dueMonthGuess: number | null // month (1–12) of lastDate for quarterly/yearly; null otherwise
  categoryGuess: string // modal category, falling back to 'Uncategorized'
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WINDOW_MONTHS = 13

/** Median-interval band (days) → bill frequency, with its occurrence floor. */
const BANDS: { frequency: BillFrequency; min: number; max: number; minOccurrences: number }[] = [
  { frequency: 'weekly', min: 5, max: 9, minOccurrences: 3 },
  { frequency: 'monthly', min: 28, max: 33, minOccurrences: 3 },
  { frequency: 'quarterly', min: 85, max: 95, minOccurrences: 3 },
  { frequency: 'yearly', min: 350, max: 380, minOccurrences: 2 },
]

const toCents = (n: number) => Math.round(n * 100) / 100

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Lowercase, collapse whitespace, strip one trailing digit run ("NETFLIX.COM 4029" → "netflix.com"). */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s#*-]*\d+$/, '')
    .trim()
}

/**
 * Detects recurring charges in the trailing 13 months before `today`.
 * Expenses only, Transfer excluded, raw parent rows (splits are irrelevant —
 * detection is merchant-level). Sorted by monthly-equivalent impact, descending.
 */
export function detectRecurring(transactions: Transaction[], today: Date): RecurringCandidate[] {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - WINDOW_MONTHS, today.getUTCDate()),
  )
  const startIso = start.toISOString().slice(0, 10)

  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.amount >= 0) continue
    if (t.category === 'Transfer') continue
    if (t.date < startIso) continue
    const key = normalizeMerchant(t.merchant_name)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }

  const out: RecurringCandidate[] = []
  for (const [key, txns] of groups) {
    const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1))
    if (sorted.length < 2) continue

    const days = sorted.map((t) => new Date(`${t.date}T00:00:00Z`).getTime() / MS_PER_DAY)
    const intervals: number[] = []
    for (let i = 1; i < days.length; i++) intervals.push(days[i] - days[i - 1])
    const med = median(intervals)

    const band = BANDS.find((b) => med >= b.min && med <= b.max)
    if (!band) continue
    if (sorted.length < band.minOccurrences) continue
    if (!intervals.every((iv) => Math.abs(iv - med) <= med * 0.2)) continue

    const magnitudes = sorted.map((t) => Math.abs(t.amount))
    const medAmount = median(magnitudes)
    if (!magnitudes.every((m) => Math.abs(m - medAmount) <= medAmount * 0.3)) continue

    const counts = new Map<string, number>()
    for (const t of sorted) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    let modal = 'Uncategorized'
    let best = 0
    for (const [category, n] of counts) {
      if (n > best) {
        best = n
        modal = category
      }
    }
    const categoryGuess = (SPENDING_CATEGORIES as readonly string[]).includes(modal)
      ? modal
      : 'Uncategorized'

    const last = sorted[sorted.length - 1]
    const lastD = new Date(`${last.date}T00:00:00Z`)
    out.push({
      merchantKey: key,
      displayName: last.merchant_name,
      frequency: band.frequency,
      amount: toCents(medAmount),
      occurrences: sorted.length,
      lastDate: last.date,
      dueDayGuess: band.frequency === 'weekly' ? lastD.getUTCDay() : lastD.getUTCDate(),
      dueMonthGuess:
        band.frequency === 'quarterly' || band.frequency === 'yearly'
          ? lastD.getUTCMonth() + 1
          : null,
      categoryGuess,
    })
  }

  return out.sort(
    (a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency),
  )
}

/**
 * Buckets candidates against tracked bills and dismissals. A candidate is
 * tracked when a bill's merchant_name equals its key (exact link, set on
 * promote) or a bill's normalized name fuzzy-matches (substring either way —
 * the fallback for pre-existing manual bills). Short names (under 4 chars)
 * never fuzzy-match. Tracked > dismissed > open; tracked candidates appear
 * in neither returned list.
 */
export function matchCandidates(
  candidates: RecurringCandidate[],
  bills: Bill[],
  dismissedKeys: string[],
): { open: RecurringCandidate[]; dismissed: RecurringCandidate[] } {
  const dismissedSet = new Set(dismissedKeys)
  const open: RecurringCandidate[] = []
  const dismissed: RecurringCandidate[] = []
  for (const c of candidates) {
    const tracked = bills.some((b) => {
      if (b.merchant_name && normalizeMerchant(b.merchant_name) === c.merchantKey) return true
      const name = normalizeMerchant(b.name)
      return name.length >= 4 && (c.merchantKey.includes(name) || name.includes(c.merchantKey))
    })
    if (tracked) continue
    if (dismissedSet.has(c.merchantKey)) dismissed.push(c)
    else open.push(c)
  }
  return { open, dismissed }
}
