import { describe, it, expect } from 'vitest'
import { spendableCash } from './forecast'
import type { Account } from '@/lib/types'

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
