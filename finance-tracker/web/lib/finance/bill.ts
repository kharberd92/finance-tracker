import type { Bill, BillFrequency } from '@/lib/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Midnight-UTC copy of a date (strips any time component). */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** A due date in the given year/month (0-based; overflow normalizes), clamping the day to the month length. */
function dueOn(year: number, month0: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month0, Math.min(day, lastDay)))
}

/**
 * The next date a bill is due on or after `from`.
 * - weekly:    `due_day` is day-of-week (Sun=0 … Sat=6)
 * - monthly:   `due_day` is day-of-month (1–31, clamped)
 * - yearly:    `due_month`/`due_day`, this year if ahead else next year
 * - quarterly: every 3 months anchored at `due_month`, soonest occurrence on/after `from`
 * Returns null only when a quarterly/yearly bill is missing its `due_month`.
 */
export function nextDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  if (bill.frequency === 'weekly') {
    const delta = (bill.due_day - today.getUTCDay() + 7) % 7
    return new Date(today.getTime() + delta * MS_PER_DAY)
  }

  if (bill.frequency === 'monthly') {
    const candidate = dueOn(y, m, bill.due_day)
    return candidate >= today ? candidate : dueOn(y, m + 1, bill.due_day)
  }

  if (bill.frequency === 'yearly') {
    if (bill.due_month == null) return null
    const candidate = dueOn(y, bill.due_month - 1, bill.due_day)
    return candidate >= today ? candidate : dueOn(y + 1, bill.due_month - 1, bill.due_day)
  }

  // quarterly: start a year back (guaranteed before `from`), step +3 months until on/after today
  if (bill.due_month == null) return null
  const anchor0 = bill.due_month - 1
  let k = 0
  let candidate = dueOn(y - 1, anchor0, bill.due_day)
  while (candidate < today) {
    k += 1
    candidate = dueOn(y - 1, anchor0 + 3 * k, bill.due_day)
  }
  return candidate
}

/** The latest date a bill was due on or before `from` (current cycle's start). */
export function mostRecentDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  if (bill.frequency === 'weekly') {
    const delta = (today.getUTCDay() - bill.due_day + 7) % 7
    return new Date(today.getTime() - delta * MS_PER_DAY)
  }

  if (bill.frequency === 'monthly') {
    const candidate = dueOn(y, m, bill.due_day)
    return candidate <= today ? candidate : dueOn(y, m - 1, bill.due_day)
  }

  if (bill.frequency === 'yearly') {
    if (bill.due_month == null) return null
    const candidate = dueOn(y, bill.due_month - 1, bill.due_day)
    return candidate <= today ? candidate : dueOn(y - 1, bill.due_month - 1, bill.due_day)
  }

  // quarterly: step forward from a year back, keeping the last occurrence on/before today
  if (bill.due_month == null) return null
  const anchor0 = bill.due_month - 1
  let k = 0
  let result = dueOn(y - 1, anchor0, bill.due_day)
  while (true) {
    k += 1
    const next = dueOn(y - 1, anchor0 + 3 * k, bill.due_day)
    if (next > today) break
    result = next
  }
  return result
}

/** Whole days from `from` until the bill's next due date, or null if undefined. */
export function daysUntilDue(bill: Bill, from: Date): number | null {
  const due = nextDueDate(bill, from)
  if (!due) return null
  return Math.round((due.getTime() - atUtcMidnight(from).getTime()) / MS_PER_DAY)
}

/** Whether the bill is paid for its current billing cycle (auto-resets each cycle). */
export function isPaid(bill: Bill, from: Date): boolean {
  if (!bill.last_paid_date) return false
  const cycleStart = mostRecentDueDate(bill, from)
  if (!cycleStart) return false
  const paid = new Date(`${bill.last_paid_date}T00:00:00Z`)
  return paid >= cycleStart
}

/** Normalized monthly-equivalent cost of an amount recurring at a frequency. */
export function monthlyEquivalent(amount: number, frequency: BillFrequency): number {
  if (frequency === 'weekly') return (amount * 52) / 12
  if (frequency === 'monthly') return amount
  if (frequency === 'quarterly') return amount / 3
  return amount / 12 // yearly
}

/** Normalized monthly-equivalent cost of the bill. */
export function monthlyCost(bill: Bill): number {
  return monthlyEquivalent(bill.amount, bill.frequency)
}
