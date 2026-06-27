import { describe, it, expect } from 'vitest'
import { trailingMonths, monthlyCashflow, cashflowDomain } from './cashflow'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -10,
    date: '2026-06-15', merchant_name: 'Shop', category: 'Groceries',
    notes: null, is_manual: false, plaid_transaction_id: null, ...partial,
  }
}

describe('trailingMonths', () => {
  it('returns count months ending at current, oldest first', () => {
    expect(trailingMonths('2026-06', 6)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ])
  })

  it('rolls over year boundaries', () => {
    expect(trailingMonths('2026-02', 6)).toEqual([
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
  })
})

describe('monthlyCashflow', () => {
  it('sums positive amounts as income and negative as expense magnitude', () => {
    const txns = [
      txn({ amount: 2000, category: 'Income', date: '2026-06-01' }),
      txn({ amount: -500, category: 'Groceries', date: '2026-06-10' }),
      txn({ amount: -300, category: 'Shopping', date: '2026-06-20' }),
    ]
    expect(monthlyCashflow(txns, ['2026-06'])).toEqual([
      { month: '2026-06', income: 2000, expense: 800, net: 1200 },
    ])
  })

  it('excludes Transfer transactions from income and expense', () => {
    const txns = [
      txn({ amount: 1000, category: 'Transfer', date: '2026-06-05' }),
      txn({ amount: -1000, category: 'Transfer', date: '2026-06-06' }),
      txn({ amount: -100, category: 'Groceries', date: '2026-06-07' }),
    ]
    expect(monthlyCashflow(txns, ['2026-06'])).toEqual([
      { month: '2026-06', income: 0, expense: 100, net: -100 },
    ])
  })

  it('zero-fills months with no transactions', () => {
    expect(monthlyCashflow([], ['2026-05', '2026-06'])).toEqual([
      { month: '2026-05', income: 0, expense: 0, net: 0 },
      { month: '2026-06', income: 0, expense: 0, net: 0 },
    ])
  })

  it('buckets transactions into the right month (prefix match, not substring)', () => {
    const txns = [
      txn({ amount: -100, date: '2026-05-31' }),
      txn({ amount: -200, date: '2026-06-01' }),
    ]
    const rows = monthlyCashflow(txns, ['2026-05', '2026-06'])
    expect(rows[0].expense).toBe(100)
    expect(rows[1].expense).toBe(200)
  })
})

describe('cashflowDomain', () => {
  it('returns the largest income or expense magnitude', () => {
    const rows = [
      { month: '2026-05', income: 500, expense: 900, net: -400 },
      { month: '2026-06', income: 1200, expense: 300, net: 900 },
    ]
    expect(cashflowDomain(rows)).toBe(1200)
  })

  it('falls back to 1 when all values are zero', () => {
    expect(cashflowDomain([{ month: '2026-06', income: 0, expense: 0, net: 0 }])).toBe(1)
  })
})
