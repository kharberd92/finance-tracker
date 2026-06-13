import { describe, it, expect } from 'vitest'
import { nextDueDate, daysUntilDue } from './bill'
import type { Bill } from '@/lib/types'

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Housing',
    is_paid: false, ...partial,
  }
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('nextDueDate (monthly)', () => {
  it('returns the due_day later this month when it is still ahead', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-15')
  })

  it('rolls into next month when the due_day has passed', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-05')
  })

  it('treats the due_day itself as due today', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 10 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-10')
  })
})

describe('nextDueDate (weekly)', () => {
  it('returns the next occurrence of the weekday (Sun=0)', () => {
    // 2026-06-10 is a Wednesday (day 3); next Friday (day 5) is 2026-06-12
    const due = nextDueDate(bill({ frequency: 'weekly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-12')
  })

  it('returns today when the weekday matches', () => {
    // 2026-06-10 is a Wednesday (day 3)
    const due = nextDueDate(bill({ frequency: 'weekly', due_day: 3 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-10')
  })
})

describe('nextDueDate (deferred frequencies)', () => {
  it('returns null for quarterly and yearly (pending schema anchor)', () => {
    expect(nextDueDate(bill({ frequency: 'quarterly' }), d('2026-06-10'))).toBeNull()
    expect(nextDueDate(bill({ frequency: 'yearly' }), d('2026-06-10'))).toBeNull()
  })
})

describe('daysUntilDue', () => {
  it('counts whole days to the next due date', () => {
    expect(daysUntilDue(bill({ frequency: 'monthly', due_day: 15 }), d('2026-06-10'))).toBe(5)
  })

  it('returns 0 when due today', () => {
    expect(daysUntilDue(bill({ frequency: 'monthly', due_day: 10 }), d('2026-06-10'))).toBe(0)
  })

  it('returns null when the next due date is undefined', () => {
    expect(daysUntilDue(bill({ frequency: 'yearly' }), d('2026-06-10'))).toBeNull()
  })
})
