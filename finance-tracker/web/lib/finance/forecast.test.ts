import { describe, it, expect } from 'vitest'
import { spendableCash, detectIncomeStreams } from './forecast'
import type { Account, Transaction } from '@/lib/types'

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'Checking', type: 'checking',
    current_balance: 0, institution_name: 'Bank', ...partial,
  }
}

describe('spendableCash', () => {
  it('sums checking and savings', () => {
    const out = spendableCash([
      acct({ id: 'a', type: 'checking', current_balance: 1200 }),
      acct({ id: 'b', type: 'savings', current_balance: 5000 }),
    ])
    expect(out).toBe(6200)
  })

  it('ignores investment accounts', () => {
    // A forecast that counts a 401k never dips, which is the opposite of
    // what the question "how low does my cash get" is asking.
    const out = spendableCash([
      acct({ id: 'a', type: 'checking', current_balance: 1200 }),
      acct({ id: 'i', type: 'investment', current_balance: 90_000 }),
    ])
    expect(out).toBe(1200)
  })

  it('ignores credit accounts rather than subtracting them', () => {
    // A card balance is debt, not a resource. Subtracting it here would
    // answer a net-worth question, and would double-count once the card
    // payment itself projects as a bill.
    const out = spendableCash([
      acct({ id: 'a', type: 'checking', current_balance: 1200 }),
      acct({ id: 'c', type: 'credit', current_balance: 800 }),
    ])
    expect(out).toBe(1200)
  })

  it('is 0 with no accounts', () => {
    expect(spendableCash([])).toBe(0)
  })
})

function inflow(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: 'a', amount: 2400,
    date: '2026-07-01', merchant_name: 'Acme Payroll', category: 'Income',
    notes: null, is_manual: false, ...partial,
  }
}

/** One transaction per date, ids unique, shared overrides. */
function pay(dates: string[], over: Partial<Transaction> = {}): Transaction[] {
  return dates.map((d, i) => inflow({ id: `p${i}`, date: d, ...over }))
}

const TODAY = new Date('2026-07-19T00:00:00Z')

describe('detectIncomeStreams', () => {
  it('detects a biweekly paycheck the frequency bands cannot express', () => {
    // 14 days falls between the weekly band (5–9) and the monthly one
    // (28–33), so a named-frequency detector misses it entirely. This is
    // the case that forced interval-based projection.
    const txns = pay(['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12', '2026-06-26'])
    const [s] = detectIncomeStreams(txns, TODAY)
    expect(s).toMatchObject({
      merchantKey: 'acme payroll',
      amount: 2400,
      medianIntervalDays: 14,
      occurrences: 5,
      lastDate: '2026-06-26',
    })
  })

  it('detects a semi-monthly paycheck', () => {
    // The 15th and the last day: intervals alternate ~15/~16 days.
    const txns = pay(['2026-04-15', '2026-04-30', '2026-05-15', '2026-05-31', '2026-06-15'])
    const [s] = detectIncomeStreams(txns, TODAY)
    expect(s.merchantKey).toBe('acme payroll')
    expect(s.medianIntervalDays).toBeGreaterThanOrEqual(15)
    expect(s.medianIntervalDays).toBeLessThanOrEqual(16)
  })

  it('detects a monthly paycheck', () => {
    const txns = pay(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'])
    expect(detectIncomeStreams(txns, TODAY)).toHaveLength(1)
  })

  it('rejects an irregular payer', () => {
    // Gig work: nothing to project a next date from.
    const txns = pay(['2026-03-02', '2026-03-29', '2026-05-20', '2026-06-01'])
    expect(detectIncomeStreams(txns, TODAY)).toEqual([])
  })

  it('rejects a regular stream whose amounts swing too far', () => {
    const txns = [
      inflow({ id: 'a', date: '2026-04-01', amount: 500 }),
      inflow({ id: 'b', date: '2026-05-01', amount: 2400 }),
      inflow({ id: 'c', date: '2026-06-01', amount: 900 }),
    ]
    expect(detectIncomeStreams(txns, TODAY)).toEqual([])
  })

  it('ignores Transfer inflows', () => {
    // Moving money between your own accounts is not income; counting it
    // would inflate every projection by the size of your savings habit.
    const txns = pay(
      ['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12'],
      { category: 'Transfer', merchant_name: 'Transfer from Savings' },
    )
    expect(detectIncomeStreams(txns, TODAY)).toEqual([])
  })

  it('ignores expenses entirely', () => {
    const txns = pay(['2026-05-01', '2026-06-01', '2026-07-01'], { amount: -50 })
    expect(detectIncomeStreams(txns, TODAY)).toEqual([])
  })

  it('rejects a stream with only two occurrences', () => {
    expect(detectIncomeStreams(pay(['2026-05-01', '2026-06-01']), TODAY)).toEqual([])
  })

  it('sorts by amount, largest first', () => {
    const txns = [
      ...pay(['2026-04-01', '2026-05-01', '2026-06-01'], { merchant_name: 'Side Gig', amount: 300 }),
      ...pay(['2026-04-03', '2026-05-03', '2026-06-03'], { merchant_name: 'Acme Payroll' }),
    ]
    expect(detectIncomeStreams(txns, TODAY).map((s) => s.merchantKey)).toEqual([
      'acme payroll',
      'side gig',
    ])
  })
})
