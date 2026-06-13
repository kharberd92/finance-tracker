import { describe, it, expect } from 'vitest'
import { spentThisMonth, budgetRemaining } from './budget'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', amount: 0, date: '2026-06-15',
    merchant_name: 'm', category: 'Groceries', is_manual: false, ...partial,
  }
}

describe('spentThisMonth', () => {
  it('sums absolute value of expenses in the category and month', () => {
    const txns = [
      txn({ category: 'Groceries', amount: -40, date: '2026-06-02' }),
      txn({ category: 'Groceries', amount: -60, date: '2026-06-20' }),
    ]
    expect(spentThisMonth(txns, 'Groceries', 2026, 6)).toBe(100)
  })

  it('ignores other categories, other months, and income', () => {
    const txns = [
      txn({ category: 'Groceries', amount: -40, date: '2026-06-02' }),
      txn({ category: 'Dining', amount: -25, date: '2026-06-02' }),   // other category
      txn({ category: 'Groceries', amount: -99, date: '2026-05-30' }), // other month
      txn({ category: 'Groceries', amount: 500, date: '2026-06-01' }), // income (positive)
    ]
    expect(spentThisMonth(txns, 'Groceries', 2026, 6)).toBe(40)
  })

  it('returns 0 when nothing matches', () => {
    expect(spentThisMonth([], 'Groceries', 2026, 6)).toBe(0)
  })
})

describe('budgetRemaining', () => {
  it('returns limit minus spent', () => {
    expect(budgetRemaining(500, 120)).toBe(380)
  })

  it('can go negative when over budget', () => {
    expect(budgetRemaining(100, 150)).toBe(-50)
  })
})
