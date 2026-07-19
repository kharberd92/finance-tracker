import { describe, it, expect } from 'vitest'
import { normalizeMerchant, detectRecurring, matchCandidates } from './recurring'
import type { Transaction, Bill } from '@/lib/types'
import type { RecurringCandidate } from './recurring'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -15.49,
    date: '2026-07-01', merchant_name: 'Netflix.com', category: 'Entertainment',
    notes: null, is_manual: false, ...partial,
  }
}

const TODAY = new Date('2026-07-19T00:00:00Z')

/** One txn per date, ids unique, shared overrides. */
function series(dates: string[], over: Partial<Transaction> = {}): Transaction[] {
  return dates.map((d, i) => txn({ id: `t${i}`, date: d, ...over }))
}

describe('normalizeMerchant', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeMerchant('  Spotify   USA  ')).toBe('spotify usa')
  })

  it('strips a trailing digit run', () => {
    expect(normalizeMerchant('NETFLIX.COM 4029')).toBe('netflix.com')
  })

  it('keeps internal digits', () => {
    expect(normalizeMerchant('7-Eleven')).toBe('7-eleven')
  })

  it('returns empty for digit-only names', () => {
    expect(normalizeMerchant('12345')).toBe('')
  })
})

describe('detectRecurring — cadence classification', () => {
  it('detects a monthly charge', () => {
    const txns = series(['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'])
    const [c] = detectRecurring(txns, TODAY)
    expect(c).toMatchObject({
      merchantKey: 'netflix.com',
      frequency: 'monthly',
      amount: 15.49,
      occurrences: 5,
      lastDate: '2026-06-15',
      dueDayGuess: 15,
      dueMonthGuess: null,
      categoryGuess: 'Entertainment',
    })
  })

  it('detects a weekly charge with day-of-week dueDayGuess', () => {
    // 2026-06-05 is a Friday (day 5)
    const txns = series(['2026-05-22', '2026-05-29', '2026-06-05'], { merchant_name: 'GymPass' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('weekly')
    expect(c.dueDayGuess).toBe(5)
  })

  it('detects a quarterly charge with dueMonthGuess', () => {
    const txns = series(['2025-10-05', '2026-01-05', '2026-04-05'], { merchant_name: 'Water Utility' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('quarterly')
    expect(c.dueDayGuess).toBe(5)
    expect(c.dueMonthGuess).toBe(4)
  })

  it('detects a yearly charge from only two occurrences', () => {
    const txns = series(['2025-08-01', '2026-07-30'], { merchant_name: 'Domain Renewal' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('yearly')
    expect(c.occurrences).toBe(2)
    expect(c.dueMonthGuess).toBe(7)
  })
})

describe('detectRecurring — rejection guards', () => {
  it('rejects a 14-day cadence (not a bill frequency)', () => {
    const txns = series(['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects erratic intervals (beyond ±20% of median)', () => {
    // intervals 31, 19, 42 — median 31, 19 and 42 both deviate > 6.2
    const txns = series(['2026-03-01', '2026-04-01', '2026-04-20', '2026-06-01'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects wildly varying amounts (beyond ±30% of median)', () => {
    const dates = ['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10']
    const amounts = [-10, -50, -12, -11, -12]
    const txns = dates.map((d, i) => txn({ id: `t${i}`, date: d, amount: amounts[i] }))
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects monthly cadence with fewer than 3 occurrences', () => {
    const txns = series(['2026-05-10', '2026-06-09'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })
})

describe('detectRecurring — input filtering', () => {
  it('ignores income, Transfer, blank merchants, and pre-window history', () => {
    const txns = [
      ...series(['2026-04-01', '2026-05-01', '2026-06-01'], { amount: 3000, category: 'Income' }),
      ...series(['2026-04-02', '2026-05-02', '2026-06-02'], { merchant_name: 'My Savings', category: 'Transfer' }),
      ...series(['2026-04-03', '2026-05-03', '2026-06-03'], { merchant_name: '99887' }),
      // window start is 2025-06-19; this series ended before it
      ...series(['2025-03-10', '2025-04-10', '2025-05-10'], { merchant_name: 'Old Gym' }),
    ]
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('falls back to Uncategorized when the modal category is not a spending category', () => {
    const txns = series(['2026-04-15', '2026-05-15', '2026-06-15'], { category: 'Split' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.categoryGuess).toBe('Uncategorized')
  })

  it('sorts candidates by monthly-equivalent impact, descending', () => {
    const txns = [
      ...series(['2026-04-01', '2026-05-01', '2026-06-01'], { merchant_name: 'Cheap Sub', amount: -5 }),
      ...series(['2026-04-02', '2026-05-02', '2026-06-02'], { merchant_name: 'Big Rent', amount: -1500 }),
    ]
    const out = detectRecurring(txns, TODAY)
    expect(out.map((c) => c.merchantKey)).toEqual(['big rent', 'cheap sub'])
  })
})

describe('matchCandidates', () => {
  function candidate(partial: Partial<RecurringCandidate>): RecurringCandidate {
    return {
      merchantKey: 'netflix.com', displayName: 'Netflix.com', frequency: 'monthly' as const,
      amount: 15.49, occurrences: 5, lastDate: '2026-06-15',
      dueDayGuess: 15, dueMonthGuess: null, categoryGuess: 'Entertainment',
      ...partial,
    }
  }
  function bill(partial: Partial<Bill>): Bill {
    return {
      id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
      due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
      due_month: null, last_paid_date: null, merchant_name: null, ...partial,
    }
  }

  it('excludes a candidate tracked via exact merchant link', () => {
    const { open, dismissed } = matchCandidates(
      [candidate({})], [bill({ merchant_name: 'netflix.com' })], [],
    )
    expect(open).toEqual([])
    expect(dismissed).toEqual([])
  })

  it('excludes a candidate tracked via fuzzy bill-name match', () => {
    const { open } = matchCandidates([candidate({})], [bill({ name: 'Netflix' })], [])
    expect(open).toEqual([])
  })

  it('a very short bill name does not fuzzy-match unrelated candidates', () => {
    const { open } = matchCandidates([candidate({})], [bill({ name: 'Net' })], [])
    expect(open).toHaveLength(1)
  })

  it('buckets a dismissed candidate', () => {
    const { open, dismissed } = matchCandidates([candidate({})], [], ['netflix.com'])
    expect(open).toEqual([])
    expect(dismissed).toHaveLength(1)
  })

  it('tracked wins over dismissed', () => {
    const { open, dismissed } = matchCandidates(
      [candidate({})], [bill({ merchant_name: 'netflix.com' })], ['netflix.com'],
    )
    expect(open).toEqual([])
    expect(dismissed).toEqual([])
  })

  it('leaves unmatched candidates open', () => {
    const { open } = matchCandidates([candidate({})], [bill({})], [])
    expect(open).toHaveLength(1)
  })
})
