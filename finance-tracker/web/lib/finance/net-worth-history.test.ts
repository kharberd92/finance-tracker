import { describe, it, expect } from 'vitest'
import {
  reconstructBalances,
  netWorthSeries,
  netWorthDelta,
  netWorthRuns,
  sliceTrailingMonths,
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
    expect(out).toEqual([
      { as_of: '2026-08-01', net_worth: 600, source: 'observed', complete: true },
    ])
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

  it('marks dates missing an account incomplete when a card is linked mid-series', () => {
    // Three weeks of checking-only capture, then a credit card with $8,000 of
    // debt is linked. Summing whatever rows exist would put net worth at
    // $10,000 for the first three weeks and $2,000 after — a $8,000 "loss" the
    // user never took (and the reverse for a linked savings account).
    const snapshots: BalanceSnapshot[] = [
      snap({ account_id: 'a', as_of: '2026-08-01', balance: 10_000 }),
      snap({ account_id: 'a', as_of: '2026-08-02', balance: 10_000 }),
      snap({ account_id: 'a', as_of: '2026-08-22', balance: 10_000 }),
      snap({ account_id: 'c', as_of: '2026-08-22', balance: 8_000 }),
    ]
    const out = netWorthSeries(snapshots, accounts)

    expect(out.map((p) => [p.as_of, p.complete])).toEqual([
      ['2026-08-01', false],
      ['2026-08-02', false],
      ['2026-08-22', true],
    ])
    // ...and the delta refuses to compare across that boundary.
    expect(netWorthDelta(out, 30)).toBeNull()
  })

  it('marks the sawtooth month-end from a re-run backfill as the only complete date', () => {
    // Re-running the backfill after linking an account writes reconstructed
    // month-ends for the new account INSIDE the existing observed daily range.
    // Those dates hold both accounts while the days around them hold one, which
    // would spike the line by the new account's full balance once a month.
    const snapshots: BalanceSnapshot[] = [
      snap({ account_id: 'a', as_of: '2026-07-30', balance: 10_000 }),
      snap({ account_id: 'a', as_of: '2026-07-31', balance: 10_000 }),
      snap({ account_id: 'c', as_of: '2026-07-31', balance: 8_000, source: 'reconstructed' }),
      snap({ account_id: 'a', as_of: '2026-08-01', balance: 10_000 }),
    ]
    const out = netWorthSeries(snapshots, accounts)

    expect(out.filter((p) => p.complete).map((p) => p.as_of)).toEqual(['2026-07-31'])
  })

  it('counts each account once per date, not once per snapshot row', () => {
    const out = netWorthSeries(
      [
        snap({ account_id: 'a', as_of: '2026-08-01', balance: 1000 }),
        snap({ account_id: 'a', as_of: '2026-08-02', balance: 1000 }),
        snap({ account_id: 'c', as_of: '2026-08-02', balance: 400 }),
      ],
      accounts,
    )
    expect(out.map((p) => p.complete)).toEqual([false, true])
  })
})

describe('sliceTrailingMonths', () => {
  const obs = (as_of: string): NetWorthPoint =>
    ({ as_of, net_worth: 0, source: 'observed', complete: true })

  it('returns nothing for an empty series', () => {
    expect(sliceTrailingMonths([], 6)).toEqual([])
  })

  it('keeps points on or after the cutoff date, measured from the newest point', () => {
    const points = [obs('2026-02-13'), obs('2026-02-14'), obs('2026-05-01'), obs('2026-08-14')]
    expect(sliceTrailingMonths(points, 6).map((p) => p.as_of)).toEqual([
      '2026-02-14',
      '2026-05-01',
      '2026-08-14',
    ])
  })

  it('reaches a full year back at 12 months', () => {
    const points = [obs('2025-08-13'), obs('2025-08-31'), obs('2026-08-14')]
    expect(sliceTrailingMonths(points, 12).map((p) => p.as_of)).toEqual([
      '2025-08-31',
      '2026-08-14',
    ])
  })

  it('clamps the cutoff day to a short month instead of rolling into the next one', () => {
    // Aug 31 minus 6 months is Feb 31; the cutoff must be Feb 28, not Mar 3.
    const points = [obs('2026-02-27'), obs('2026-02-28'), obs('2026-08-31')]
    expect(sliceTrailingMonths(points, 6).map((p) => p.as_of)).toEqual([
      '2026-02-28',
      '2026-08-31',
    ])
  })

  it('does not depend on how many points a month contains', () => {
    // A month of daily observed points plus older month-ends: a count-based
    // slice would show 12 days for "6M"; a date-based one shows six months.
    const monthEnds = ['2025-09-30', '2025-12-31', '2026-03-31', '2026-06-30'].map(obs)
    const daily = Array.from({ length: 30 }, (_, i) =>
      obs(`2026-08-${String(i + 1).padStart(2, '0')}`),
    )
    const out = sliceTrailingMonths([...monthEnds, ...daily], 6)
    expect(out[0].as_of).toBe('2026-03-31')
    expect(out).toHaveLength(32)
  })
})

describe('netWorthRuns', () => {
  const obs = (as_of: string, net_worth = 0): NetWorthPoint =>
    ({ as_of, net_worth, source: 'observed', complete: true })
  const recon = (as_of: string, net_worth = 0): NetWorthPoint =>
    ({ as_of, net_worth, source: 'reconstructed', complete: true })

  it('returns a single run when there are zero reconstructed points', () => {
    const points = [obs('2026-08-01'), obs('2026-08-02'), obs('2026-08-03')]
    const runs = netWorthRuns(points)
    expect(runs).toEqual([{ source: 'observed', indices: [0, 1, 2] }])
  })

  it('returns a single run when every point is reconstructed', () => {
    const points = [recon('2026-06-30'), recon('2026-07-31')]
    const runs = netWorthRuns(points)
    expect(runs).toEqual([{ source: 'reconstructed', indices: [0, 1] }])
  })

  it('splits interleaved sources into contiguous runs that share boundary indices', () => {
    // observed, observed, reconstructed, observed — a staggered
    // account-connection scenario, not just leading reconstructed history.
    const points = [obs('2026-08-01'), obs('2026-08-02'), recon('2026-08-03'), obs('2026-08-04')]
    const runs = netWorthRuns(points)
    expect(runs).toEqual([
      { source: 'observed', indices: [0, 1] },
      { source: 'reconstructed', indices: [1, 2] },
      { source: 'observed', indices: [2, 3] },
    ])
  })

  it('does not crash and returns one run for a single point', () => {
    const runs = netWorthRuns([obs('2026-08-01')])
    expect(runs).toEqual([{ source: 'observed', indices: [0] }])
  })

  it('returns no runs for an empty series', () => {
    expect(netWorthRuns([])).toEqual([])
  })
})

describe('netWorthDelta', () => {
  const obs = (as_of: string, net_worth: number): NetWorthPoint =>
    ({ as_of, net_worth, source: 'observed', complete: true })

  it('returns null with fewer than two observed points', () => {
    expect(netWorthDelta([obs('2026-08-10', 100)], 30)).toBeNull()
  })

  it('returns null when the only extra points are reconstructed', () => {
    const series: NetWorthPoint[] = [
      { as_of: '2026-07-31', net_worth: 50, source: 'reconstructed', complete: true },
      obs('2026-08-10', 100),
    ]
    expect(netWorthDelta(series, 30)).toBeNull()
  })

  it('ignores observed points whose date is missing an account', () => {
    // Day 1 held checking only; day 22 onward also holds a $8,000 card. Reading
    // the difference as a change in wealth would report linking the card as a
    // gain, so the incomplete point cannot anchor the delta.
    const series: NetWorthPoint[] = [
      { as_of: '2026-08-01', net_worth: 10_000, source: 'observed', complete: false },
      obs('2026-08-22', 2_000),
      obs('2026-08-23', 2_100),
    ]
    const out = netWorthDelta(series, 30)
    expect(out).toEqual({ change: 100, fromDate: '2026-08-22', toDate: '2026-08-23', days: 1 })
  })

  it('returns null when only one observed point in the window is complete', () => {
    const series: NetWorthPoint[] = [
      { as_of: '2026-08-01', net_worth: 10_000, source: 'observed', complete: false },
      obs('2026-08-22', 2_000),
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
