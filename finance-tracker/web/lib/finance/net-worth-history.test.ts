import { describe, it, expect } from 'vitest'
import { reconstructBalances } from './net-worth-history'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: 'a', amount: -10,
    date: '2026-07-10', merchant_name: 'Store', category: 'Shopping',
    notes: null, is_manual: false, ...partial,
  }
}

describe('reconstructBalances', () => {
  it('returns one month-end point per requested month, newest last', () => {
    const out = reconstructBalances(1000, 'checking', [], 3, '2026-08-14')
    expect(out.map((p) => p.as_of)).toEqual(['2026-06-30', '2026-07-31'])
  })

  it('walks an asset account backwards: a past expense means a higher past balance', () => {
    // $200 spent on Aug 5 (after the Jul 31 month-end).
    const out = reconstructBalances(1000, 'checking', [txn({ amount: -200, date: '2026-08-05' })], 2, '2026-08-14')
    const jul = out.find((p) => p.as_of === '2026-07-31')!
    expect(jul.balance).toBe(1200)
  })

  it('walks a liability account the OPPOSITE way: a past charge means lower past debt', () => {
    // current_balance on a card is positive debt owed; a $200 charge on Aug 5
    // raised it, so debt at Jul 31 was 200 LOWER, not higher.
    const out = reconstructBalances(1000, 'credit', [txn({ amount: -200, date: '2026-08-05' })], 2, '2026-08-14')
    const jul = out.find((p) => p.as_of === '2026-07-31')!
    expect(jul.balance).toBe(800)
  })

  it('treats income on an asset account as a lower past balance', () => {
    const out = reconstructBalances(1000, 'checking', [txn({ amount: 500, date: '2026-08-05' })], 2, '2026-08-14')
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(500)
  })

  it('accumulates across a month boundary', () => {
    const out = reconstructBalances(
      1000,
      'checking',
      [txn({ amount: -100, date: '2026-08-05' }), txn({ amount: -50, date: '2026-07-20' })],
      3,
      '2026-08-14',
    )
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(1100)
    expect(out.find((p) => p.as_of === '2026-06-30')!.balance).toBe(1150)
  })

  it('ignores transactions dated after today', () => {
    const out = reconstructBalances(1000, 'checking', [txn({ amount: -999, date: '2026-09-01' })], 2, '2026-08-14')
    expect(out.find((p) => p.as_of === '2026-07-31')!.balance).toBe(1000)
  })
})
