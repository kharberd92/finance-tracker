import { describe, it, expect } from 'vitest'
import { netWorth } from './net-worth'
import type { Account } from '@/lib/types'

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'x', type: 'checking',
    current_balance: 0, institution_name: 'bank', ...partial,
  }
}

describe('netWorth', () => {
  it('returns 0 for no accounts', () => {
    expect(netWorth([])).toBe(0)
  })

  it('sums asset balances (checking, savings, investment)', () => {
    const accounts = [
      acct({ type: 'checking', current_balance: 1000 }),
      acct({ type: 'savings', current_balance: 5000 }),
      acct({ type: 'investment', current_balance: 20000 }),
    ]
    expect(netWorth(accounts)).toBe(26000)
  })

  it('subtracts credit (liability) balances', () => {
    const accounts = [
      acct({ type: 'checking', current_balance: 1000 }),
      acct({ type: 'credit', current_balance: 300 }),
    ]
    expect(netWorth(accounts)).toBe(700)
  })

  it('handles a mix to a negative net worth', () => {
    const accounts = [
      acct({ type: 'savings', current_balance: 200 }),
      acct({ type: 'credit', current_balance: 1500 }),
    ]
    expect(netWorth(accounts)).toBe(-1300)
  })
})
