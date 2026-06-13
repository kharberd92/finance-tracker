import type { Bill } from '@/lib/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Midnight-UTC copy of a date (strips any time component). */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/**
 * The next date a bill is due on or after `from`.
 * - monthly: `due_day` is day-of-month (1–31)
 * - weekly:  `due_day` is day-of-week (Sun=0 … Sat=6)
 * - quarterly/yearly: null (no anchor month in the current schema — see Plan 5)
 */
export function nextDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)

  if (bill.frequency === 'monthly') {
    const candidate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), bill.due_day),
    )
    if (candidate >= today) return candidate
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, bill.due_day))
  }

  if (bill.frequency === 'weekly') {
    const delta = (bill.due_day - today.getUTCDay() + 7) % 7
    return new Date(today.getTime() + delta * MS_PER_DAY)
  }

  // quarterly / yearly — deferred to Plan 5
  return null
}

/** Whole days from `from` until the bill's next due date, or null if undefined. */
export function daysUntilDue(bill: Bill, from: Date): number | null {
  const due = nextDueDate(bill, from)
  if (!due) return null
  return Math.round((due.getTime() - atUtcMidnight(from).getTime()) / MS_PER_DAY)
}
