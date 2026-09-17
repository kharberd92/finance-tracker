import { describe, it, expect } from 'vitest'
import {
  spendableCash,
  detectIncomeStreams,
  projectEvents,
  runningBalance,
  forecastLow,
  type IncomeStream,
} from './forecast'
import type { RecurringCandidate } from './recurring'
import type { Account, Bill, Transaction } from '@/lib/types'

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

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1800, due_day: 1,
    due_month: null, frequency: 'monthly', category: 'Bills & Utilities',
    last_paid_date: null, merchant_name: null, ...partial,
  }
}

function stream(partial: Partial<IncomeStream>): IncomeStream {
  return {
    merchantKey: 'acme payroll', displayName: 'Acme Payroll', amount: 2400,
    medianIntervalDays: 14, lastDate: '2026-07-17', occurrences: 6, ...partial,
  }
}

function candidate(partial: Partial<RecurringCandidate>): RecurringCandidate {
  return {
    merchantKey: 'netflix.com', displayName: 'Netflix.com', frequency: 'monthly',
    amount: 15.49, occurrences: 5, medianIntervalDays: 30, lastDate: '2026-07-15',
    dueDayGuess: 15, dueMonthGuess: null, categoryGuess: 'Entertainment', ...partial,
  }
}

const NONE = { bills: [], candidates: [], incomeStreams: [] }

describe('projectEvents — bills', () => {
  it('projects a monthly bill at its real due date', () => {
    const out = projectEvents({ ...NONE, bills: [bill({ due_day: 1 })] }, 30, TODAY)
    expect(out).toEqual([
      { date: '2026-08-01', label: 'Rent', amount: -1800, kind: 'bill' },
    ])
  })

  it('skips an occurrence already paid, keeping later ones', () => {
    // Paid ahead for the 25th: that money already moved, so projecting it
    // would double-count. August's is still owed and must survive.
    const paid = bill({ due_day: 25, last_paid_date: '2026-07-25' })
    const out = projectEvents({ ...NONE, bills: [paid] }, 60, TODAY)
    expect(out.map((e) => e.date)).toEqual(['2026-08-25'])
  })

  it('still projects the upcoming charge when only the PREVIOUS one was paid', () => {
    // The regression this guards: isPaid() is true here (the cycle that began
    // 06-25 is settled) while 07-25 is very much still owed. Skipping on
    // isPaid would drop a real outflow and flatter the projected low.
    const paid = bill({ due_day: 25, last_paid_date: '2026-06-25' })
    const out = projectEvents({ ...NONE, bills: [paid] }, 30, TODAY)
    expect(out.map((e) => e.date)).toEqual(['2026-07-25'])
  })

  it('still projects an unpaid bill due inside the horizon', () => {
    const out = projectEvents({ ...NONE, bills: [bill({ due_day: 25 })] }, 30, TODAY)
    expect(out.map((e) => e.date)).toEqual(['2026-07-25'])
  })

  it('lands a quarterly bill in 60 days but not in 30', () => {
    const q = bill({ name: 'Water', frequency: 'quarterly', due_month: 3, due_day: 10, amount: 240 })
    expect(projectEvents({ ...NONE, bills: [q] }, 30, TODAY)).toEqual([])
    expect(projectEvents({ ...NONE, bills: [q] }, 60, TODAY).map((e) => e.date)).toEqual([
      '2026-09-10',
    ])
  })

  it('drops a quarterly bill with no anchor month rather than guessing one', () => {
    const broken = bill({ frequency: 'quarterly', due_month: null })
    expect(projectEvents({ ...NONE, bills: [broken] }, 60, TODAY)).toEqual([])
  })
})

describe('projectEvents — streams', () => {
  it('projects income forward from lastDate by the median interval', () => {
    const out = projectEvents({ ...NONE, incomeStreams: [stream({ lastDate: '2026-07-17' })] }, 30, TODAY)
    expect(out).toEqual([
      { date: '2026-07-31', label: 'Acme Payroll', amount: 2400, kind: 'income' },
      { date: '2026-08-14', label: 'Acme Payroll', amount: 2400, kind: 'income' },
    ])
  })

  it('never re-counts an occurrence that already happened', () => {
    // lastDate is the most recent ACTUAL charge. Projecting from k=0 would
    // bill the user twice for money that already left.
    const out = projectEvents({ ...NONE, incomeStreams: [stream({ lastDate: TODAY.toISOString().slice(0, 10) })] }, 30, TODAY)
    expect(out.every((e) => e.date > '2026-07-19')).toBe(true)
  })

  it('projects a detected recurring charge as an outflow', () => {
    const out = projectEvents({ ...NONE, candidates: [candidate({ lastDate: '2026-07-15' })] }, 30, TODAY)
    expect(out[0]).toEqual({
      date: '2026-08-14',
      label: 'Netflix.com',
      amount: -15.49,
      kind: 'recurring',
    })
  })

  it('rounds a fractional interval rather than drifting', () => {
    // Calendar months give medians like 30.5; dates must stay whole days.
    const out = projectEvents(
      { ...NONE, candidates: [candidate({ lastDate: '2026-07-01', medianIntervalDays: 30.5 })] },
      70,
      TODAY,
    )
    expect(out.map((e) => e.date)).toEqual(['2026-08-01', '2026-08-31'])
  })

  it('ignores a stream with a non-positive interval', () => {
    const out = projectEvents({ ...NONE, incomeStreams: [stream({ medianIntervalDays: 0 })] }, 30, TODAY)
    expect(out).toEqual([])
  })
})

describe('projectEvents — ordering', () => {
  it('returns every event ascending by date', () => {
    const out = projectEvents(
      {
        bills: [bill({ due_day: 1 }), bill({ id: 'b2', name: 'Gym', due_day: 28, amount: 40 })],
        candidates: [candidate({ lastDate: '2026-07-10' })],
        incomeStreams: [stream({ lastDate: '2026-07-17' })],
      },
      30,
      TODAY,
    )
    const dates = out.map((e) => e.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('runningBalance and forecastLow', () => {
  it('walks the balance through each event', () => {
    const events = projectEvents({ ...NONE, bills: [bill({ due_day: 1 })] }, 30, TODAY)
    expect(runningBalance(3000, events)).toEqual([{ date: '2026-08-01', balance: 1200 }])
  })

  it('finds the low and the date it lands', () => {
    const points = [
      { date: '2026-07-25', balance: 900 },
      { date: '2026-08-01', balance: -150 },
      { date: '2026-08-14', balance: 2250 },
    ]
    expect(forecastLow(points)).toEqual({ balance: -150, date: '2026-08-01' })
  })

  it('prefers the earliest of tied minima', () => {
    const points = [
      { date: '2026-07-25', balance: 100 },
      { date: '2026-08-01', balance: 100 },
    ]
    expect(forecastLow(points)?.date).toBe('2026-07-25')
  })

  it('returns null for an empty series', () => {
    expect(forecastLow([])).toBeNull()
  })
})
