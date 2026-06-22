import { describe, it, expect } from 'vitest'
import { nextDueDate, daysUntilDue, mostRecentDueDate, isPaid, monthlyCost } from './bill'
import type { Bill } from '@/lib/types'

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
    due_month: null, last_paid_date: null, ...partial,
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

describe('nextDueDate (yearly)', () => {
  it('returns this year when the month/day is still ahead', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 12, due_day: 25 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-12-25')
  })

  it('rolls to next year when the date has passed', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 3, due_day: 10 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-03-10')
  })

  it('clamps the day to the month length', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 2, due_day: 31 }), d('2026-03-01'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-02-28')
  })
})

describe('nextDueDate (quarterly)', () => {
  it('returns the soonest anchored quarter on/after the date', () => {
    const due = nextDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-15')
  })

  it('rolls into next year past the last quarter', () => {
    const due = nextDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-10-20'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-01-15')
  })
})

describe('mostRecentDueDate', () => {
  it('monthly: the due_day this month when already passed', () => {
    const due = mostRecentDueDate(bill({ frequency: 'monthly', due_day: 1 }), d('2026-06-15'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-01')
  })

  it('monthly: last month when the due_day is still ahead', () => {
    const due = mostRecentDueDate(bill({ frequency: 'monthly', due_day: 20 }), d('2026-06-15'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-05-20')
  })

  it('weekly: the most recent occurrence of the weekday', () => {
    const due = mostRecentDueDate(bill({ frequency: 'weekly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-05')
  })

  it('quarterly: the most recent anchored quarter', () => {
    const due = mostRecentDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-04-15')
  })
})

describe('isPaid', () => {
  it('is paid when last_paid_date is in the current cycle', () => {
    const b = bill({ frequency: 'monthly', due_day: 1, last_paid_date: '2026-06-03' })
    expect(isPaid(b, d('2026-06-15'))).toBe(true)
  })

  it('auto-resets to unpaid once the next cycle begins', () => {
    const b = bill({ frequency: 'monthly', due_day: 1, last_paid_date: '2026-06-03' })
    expect(isPaid(b, d('2026-07-02'))).toBe(false)
  })

  it('is unpaid when last_paid_date is null', () => {
    expect(isPaid(bill({ last_paid_date: null }), d('2026-06-15'))).toBe(false)
  })
})

describe('monthlyCost', () => {
  it('normalizes each frequency to a monthly figure', () => {
    expect(monthlyCost(bill({ frequency: 'weekly', amount: 60 }))).toBe(260)
    expect(monthlyCost(bill({ frequency: 'monthly', amount: 1200 }))).toBe(1200)
    expect(monthlyCost(bill({ frequency: 'quarterly', amount: 300 }))).toBe(100)
    expect(monthlyCost(bill({ frequency: 'yearly', amount: 1200 }))).toBe(100)
  })
})
