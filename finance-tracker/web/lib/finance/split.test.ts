import { describe, it, expect } from 'vitest'
import { explodeSplits, splitTotal, splitsMatchParent } from './split'
import type { Transaction, TransactionSplit } from '@/lib/types'

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    user_id: 'u1',
    account_id: 'a1',
    amount: -100,
    date: '2026-07-10',
    merchant_name: 'Target',
    category: 'Split',
    is_manual: false,
    ...over,
  }
}

function split(over: Partial<TransactionSplit> = {}): TransactionSplit {
  return { id: 's1', user_id: 'u1', transaction_id: 't1', category: 'Groceries', amount: -60, ...over }
}

describe('splitTotal', () => {
  it('sums magnitudes rounded to cents', () => {
    expect(splitTotal([{ amount: -60 }, { amount: -40 }])).toBe(100)
    expect(splitTotal([{ amount: -33.33 }, { amount: -33.33 }, { amount: -33.34 }])).toBe(100)
  })
})

describe('splitsMatchParent', () => {
  it('true when magnitudes equal the parent magnitude', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -40 }])).toBe(true)
    expect(splitsMatchParent(100, [{ amount: 60 }, { amount: 40 }])).toBe(true)
  })
  it('tolerates a sub-cent difference', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -39.995 }])).toBe(true)
  })
  it('false when parts do not add up', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -30 }])).toBe(false)
  })
})

describe('explodeSplits', () => {
  it('passes non-split transactions through unchanged', () => {
    const t = txn({ id: 't9', category: 'Groceries', amount: -20 })
    expect(explodeSplits([t], [])).toEqual([t])
  })

  it('replaces a split parent with one row per part', () => {
    const t = txn()
    const parts = [split({ id: 's1', category: 'Groceries', amount: -60 }), split({ id: 's2', category: 'Shopping', amount: -40 })]
    const out = explodeSplits([t], parts)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.category)).toEqual(['Groceries', 'Shopping'])
    expect(out.map((r) => r.amount)).toEqual([-60, -40])
    // parent fields preserved
    expect(out[0].date).toBe('2026-07-10')
    expect(out[0].merchant_name).toBe('Target')
    expect(out[0].account_id).toBe('a1')
    // synthetic ids are unique
    expect(new Set(out.map((r) => r.id)).size).toBe(2)
  })

  it('leaves other transactions untouched while exploding one', () => {
    const a = txn({ id: 't1' })
    const b = txn({ id: 't2', category: 'Travel', amount: -50 })
    const out = explodeSplits([a, b], [split({ transaction_id: 't1', amount: -60 }), split({ id: 's2', transaction_id: 't1', category: 'Shopping', amount: -40 })])
    expect(out).toHaveLength(3)
    expect(out.find((r) => r.id === 't2')).toEqual(b)
  })
})
