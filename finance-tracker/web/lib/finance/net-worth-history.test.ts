import { describe, it, expect } from 'vitest'
import {
  reconstructBalances,
  netWorthSeries,
  netWorthDelta,
  type BalanceSnapshot,
  type NetWorthPoint,
} from './net-worth-history'
import type { Account, Transaction } from '@/lib/types'

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

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'Checking', type: 'checking',
    current_balance: 0, institution_name: 'Bank', ...partial,
  }
}

function snap(partial: Partial<BalanceSnapshot>): BalanceSnapshot {
  return { account_id: 'a', as_of: '2026-08-01', balance: 100, source: 'observed', ...partial }
}

describe('netWorthSeries', () => {
  const accounts = [acct({ id: 'a', type: 'checking' }), acct({ id: 'c', type: 'credit' })]

  it('subtracts liability balances and adds asset balances per date', () => {
    const out = netWorthSeries(
      [
        snap({ account_id: 'a', as_of: '2026-08-01', balance: 1000 }),
        snap({ account_id: 'c', as_of: '2026-08-01', balance: 400 }),
      ],
      accounts,
    )
    expect(out).toEqual([{ as_of: '2026-08-01', net_worth: 600, source: 'observed' }])
  })

  it('sorts points ascending by date', () => {
    const out = netWorthSeries(
      [snap({ as_of: '2026-08-02' }), snap({ as_of: '2026-08-01' })],
      accounts,
    )
    expect(out.map((p) => p.as_of)).toEqual(['2026-08-01', '2026-08-02'])
  })

  it('marks a date reconstructed when any contributing snapshot is reconstructed', () => {
    const out = netWorthSeries(
      [
        snap({ account_id: 'a', as_of: '2026-08-01', balance: 1000, source: 'observed' }),
        snap({ account_id: 'c', as_of: '2026-08-01', balance: 400, source: 'reconstructed' }),
      ],
      accounts,
    )
    expect(out[0].source).toBe('reconstructed')
  })

  it('ignores snapshots for accounts that no longer exist', () => {
    const out = netWorthSeries([snap({ account_id: 'gone', balance: 999 })], accounts)
    expect(out).toEqual([])
  })
})

describe('netWorthDelta', () => {
  const obs = (as_of: string, net_worth: number): NetWorthPoint =>
    ({ as_of, net_worth, source: 'observed' })

  it('returns null with fewer than two observed points', () => {
    expect(netWorthDelta([obs('2026-08-10', 100)], 30)).toBeNull()
  })

  it('returns null when the only extra points are reconstructed', () => {
    const series: NetWorthPoint[] = [
      { as_of: '2026-07-31', net_worth: 50, source: 'reconstructed' },
      obs('2026-08-10', 100),
    ]
    expect(netWorthDelta(series, 30)).toBeNull()
  })

  it('measures change between the oldest and newest observed points in the window', () => {
    const out = netWorthDelta([obs('2026-07-20', 800), obs('2026-08-10', 1000)], 30)
    expect(out).toEqual({ change: 200, fromDate: '2026-07-20', toDate: '2026-08-10', days: 21 })
  })

  it('excludes observed points older than the window', () => {
    const out = netWorthDelta([obs('2026-01-01', 1), obs('2026-08-01', 900), obs('2026-08-10', 1000)], 30)
    expect(out!.fromDate).toBe('2026-08-01')
    expect(out!.change).toBe(100)
  })

  it('reports the true span it measured, not the requested one', () => {
    const out = netWorthDelta([obs('2026-08-05', 900), obs('2026-08-10', 1000)], 30)
    expect(out!.days).toBe(5)
  })

  it('reports negative change when net worth fell', () => {
    expect(netWorthDelta([obs('2026-08-01', 1000), obs('2026-08-10', 900)], 30)!.change).toBe(-100)
  })
})
