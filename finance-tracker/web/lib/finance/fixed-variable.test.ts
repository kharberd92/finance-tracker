import { describe, it, expect } from 'vitest'
import {
  totalCommittedMonthly,
  variableSpend,
  committedShareOfIncome,
} from './fixed-variable'
import type { Bill, Transaction } from '@/lib/types'

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
    due_month: null, last_paid_date: null, ...partial,
  }
}

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -10,
    date: '2026-07-10', merchant_name: 'Store', category: 'Shopping',
    notes: null, is_manual: false, ...partial,
  }
}

describe('totalCommittedMonthly', () => {
  it('returns 0 for no bills', () => {
    expect(totalCommittedMonthly([])).toBe(0)
  })

  it('sums monthlyCost across mixed frequencies', () => {
    const bills = [
      bill({ frequency: 'monthly', amount: 100 }),   // 100
      bill({ frequency: 'weekly', amount: 12 }),     // 12*52/12 = 52
      bill({ frequency: 'quarterly', amount: 300, due_month: 1 }), // 100
      bill({ frequency: 'yearly', amount: 1200, due_month: 6 }),   // 100
    ]
    expect(totalCommittedMonthly(bills)).toBe(352)
  })

  it('rounds the sum to cents', () => {
    // weekly 10 → 10*52/12 = 43.333…
    expect(totalCommittedMonthly([bill({ frequency: 'weekly', amount: 10 })])).toBe(43.33)
  })
})

describe('variableSpend', () => {
  it('sums expense magnitudes in the month', () => {
    const rows = [
      txn({ amount: -25.5, category: 'Groceries' }),
      txn({ amount: -10.25, category: 'Entertainment' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(35.75)
  })

  it('excludes Transfer and Bills & Utilities', () => {
    const rows = [
      txn({ amount: -500, category: 'Transfer' }),
      txn({ amount: -1200, category: 'Bills & Utilities' }),
      txn({ amount: -40, category: 'Groceries' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(40)
  })

  it('ignores income and other months', () => {
    const rows = [
      txn({ amount: 3000, category: 'Income' }),
      txn({ amount: -40, date: '2026-06-30' }),
      txn({ amount: -60, date: '2026-07-01' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(60)
  })

  it('counts split parts individually when fed exploded rows', () => {
    // A $100 parent split $70 Groceries / $30 Bills & Utilities arrives
    // as two exploded rows; only the Groceries part is variable.
    const rows = [
      txn({ id: 'p:s1', amount: -70, category: 'Groceries' }),
      txn({ id: 'p:s2', amount: -30, category: 'Bills & Utilities' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(70)
  })

  it('returns 0 when there are no transactions', () => {
    expect(variableSpend([], '2026-07')).toBe(0)
  })
})

describe('committedShareOfIncome', () => {
  it('returns a whole percent', () => {
    expect(committedShareOfIncome(1850, 4500)).toBe(41)
  })

  it('rounds to the nearest whole percent', () => {
    expect(committedShareOfIncome(500, 1500)).toBe(33)
    expect(committedShareOfIncome(1000, 1500)).toBe(67)
  })

  it('returns null when income is zero or negative', () => {
    expect(committedShareOfIncome(1850, 0)).toBeNull()
    expect(committedShareOfIncome(1850, -5)).toBeNull()
  })
})
