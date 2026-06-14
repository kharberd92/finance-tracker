import { describe, it, expect } from 'vitest'
import { mapAccountType, mapTransaction, mapAccount, type PlaidTxnLike, type PlaidAccountLike } from './map'

describe('mapAccountType', () => {
  it('maps depository subtypes', () => {
    expect(mapAccountType('depository', 'checking')).toBe('checking')
    expect(mapAccountType('depository', 'savings')).toBe('savings')
    expect(mapAccountType('depository', null)).toBe('checking')
  })

  it('maps credit and loan to credit', () => {
    expect(mapAccountType('credit', 'credit card')).toBe('credit')
    expect(mapAccountType('loan', 'student')).toBe('credit')
  })

  it('maps investment and brokerage to investment', () => {
    expect(mapAccountType('investment', '401k')).toBe('investment')
    expect(mapAccountType('brokerage', null)).toBe('investment')
  })

  it('defaults unknown types to checking', () => {
    expect(mapAccountType('other', null)).toBe('checking')
  })
})

describe('mapTransaction', () => {
  const accountIdByPlaidId = { 'plaid-acct-1': 'our-acct-1' }

  function txn(partial: Partial<PlaidTxnLike>): PlaidTxnLike {
    return {
      transaction_id: 'ptxn-1',
      account_id: 'plaid-acct-1',
      amount: 40,
      date: '2026-06-02',
      name: 'RAW NAME',
      merchant_name: 'Trader Joe’s',
      personal_finance_category: { primary: 'FOOD_AND_DRINK' },
      ...partial,
    }
  }

  it('flips the sign so a Plaid outflow becomes a negative expense', () => {
    expect(mapTransaction(txn({ amount: 40 }), 'user-1', accountIdByPlaidId).amount).toBe(-40)
  })

  it('keeps income positive (Plaid inflow is negative)', () => {
    expect(mapTransaction(txn({ amount: -1500 }), 'user-1', accountIdByPlaidId).amount).toBe(1500)
  })

  it('resolves the account_id via the plaid id map, null when unknown', () => {
    expect(mapTransaction(txn({ account_id: 'plaid-acct-1' }), 'user-1', accountIdByPlaidId).account_id).toBe('our-acct-1')
    expect(mapTransaction(txn({ account_id: 'missing' }), 'user-1', accountIdByPlaidId).account_id).toBeNull()
  })

  it('uses merchant_name, falling back to name', () => {
    expect(mapTransaction(txn({ merchant_name: 'Costco' }), 'user-1', accountIdByPlaidId).merchant_name).toBe('Costco')
    expect(mapTransaction(txn({ merchant_name: null }), 'user-1', accountIdByPlaidId).merchant_name).toBe('RAW NAME')
  })

  it('maps category and marks the row non-manual with the Plaid id', () => {
    const row = mapTransaction(txn({}), 'user-1', accountIdByPlaidId)
    expect(row.category).toBe('Food And Drink')
    expect(row.is_manual).toBe(false)
    expect(row.plaid_transaction_id).toBe('ptxn-1')
    expect(row.user_id).toBe('user-1')
    expect(row.date).toBe('2026-06-02')
  })

  it('falls back to Uncategorized when Plaid sends no category', () => {
    const row = mapTransaction(txn({ personal_finance_category: null }), 'user-1', accountIdByPlaidId)
    expect(row.category).toBe('Uncategorized')
  })
})

describe('mapAccount', () => {
  function acct(partial: Partial<PlaidAccountLike>): PlaidAccountLike {
    return {
      account_id: 'plaid-acct-1',
      name: 'Checking',
      type: 'depository',
      subtype: 'checking',
      balances: { current: 1234.56 },
      ...partial,
    }
  }

  it('maps a Plaid account to our row shape', () => {
    const row = mapAccount(acct({}), 'user-1', 'item-1', 'Chase')
    expect(row).toEqual({
      user_id: 'user-1',
      item_id: 'item-1',
      plaid_account_id: 'plaid-acct-1',
      name: 'Checking',
      type: 'checking',
      current_balance: 1234.56,
      institution_name: 'Chase',
    })
  })

  it('defaults a null balance to 0', () => {
    expect(mapAccount(acct({ balances: { current: null } }), 'user-1', 'item-1', 'Chase').current_balance).toBe(0)
  })
})
