import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncPlaidItems } from './sync-items'
import { createSupabaseMock, createQueryStub } from './test-helpers'
import { encryptToken } from './crypto'
import type { PlaidItem } from '@/lib/types'

function makeItem(over: Partial<PlaidItem> = {}): PlaidItem {
  return {
    id: 'item-1',
    user_id: 'user-1',
    plaid_item_id: 'plaid-item-1',
    encrypted_access_token: encryptToken('access-sandbox-1'),
    sync_cursor: null,
    institution_name: 'Chase',
    ...over,
  }
}

// A Plaid client stub: one account, one added transaction, no further pages.
function createPlaidStub() {
  return {
    accountsBalanceGet: vi.fn().mockResolvedValue({
      data: {
        accounts: [
          { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } },
        ],
      },
    }),
    transactionsSync: vi.fn().mockResolvedValue({
      data: {
        added: [
          { transaction_id: 'tx-1', account_id: 'pa-1', amount: 12.5, date: '2026-06-20', name: 'Coffee', personal_finance_category: { primary: 'FOOD_AND_DRINK' } },
        ],
        modified: [],
        removed: [],
        next_cursor: 'cursor-1',
        has_more: false,
      },
    }),
  }
}

beforeEach(() => {
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('syncPlaidItems', () => {
  it('syncs an item: refreshes accounts, writes txns with item.user_id, saves cursor + last_synced_at', async () => {
    const accountsStub = createQueryStub({ data: [{ id: 'acc-1', plaid_account_id: 'pa-1' }], error: null })
    const txStub = createQueryStub()
    const itemsStub = createQueryStub()
    const db = createSupabaseMock({ tables: { accounts: accountsStub, transactions: txStub, plaid_items: itemsStub } })
    const client = createPlaidStub()

    const result = await syncPlaidItems(db as never, client as never, [makeItem({ user_id: 'user-1' })])

    expect(result.itemsSynced).toBe(1)
    expect(result.totals).toEqual({ added: 1, modified: 0, removed: 0 })
    expect(result.errors).toEqual([])
    // transactions upsert used the item's user_id
    expect(txStub.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ user_id: 'user-1', plaid_transaction_id: 'tx-1' })]),
      expect.anything(),
    )
    // cursor + last_synced_at stamped
    expect(itemsStub.update).toHaveBeenCalledWith(
      expect.objectContaining({ sync_cursor: 'cursor-1', last_synced_at: expect.any(String) }),
    )
  })

  it('isolates per-item errors: one failing item does not abort the others', async () => {
    const okAccounts = createQueryStub({ data: [{ id: 'acc-1', plaid_account_id: 'pa-1' }], error: null })
    const db = createSupabaseMock({ tables: { accounts: okAccounts, transactions: createQueryStub(), plaid_items: createQueryStub() } })
    const client = createPlaidStub()
    // First item's balance call throws; second succeeds.
    client.accountsBalanceGet
      .mockRejectedValueOnce(new Error('plaid down'))
      .mockResolvedValueOnce({ data: { accounts: [{ account_id: 'pa-1', name: 'C', type: 'depository', subtype: 'checking', balances: { current: 1 } }] } })

    const result = await syncPlaidItems(db as never, client as never, [
      makeItem({ id: 'bad', user_id: 'user-1' }),
      makeItem({ id: 'good', user_id: 'user-1' }),
    ])

    expect(result.itemsSynced).toBe(1)
    expect(result.errors).toEqual([{ itemId: 'bad', message: 'plaid down' }])
    // Positively verify the surviving item actually did its work, rather than
    // inferring it from the counter alone: the good item's one txn was counted.
    expect(result.totals).toEqual({ added: 1, modified: 0, removed: 0 })
  })

  it('sticky category: a modified txn updates Plaid-owned fields but NOT category', async () => {
    const accountsStub = createQueryStub({ data: [{ id: 'acc-1', plaid_account_id: 'pa-1' }], error: null })
    const txStub = createQueryStub()
    const db = createSupabaseMock({ tables: { accounts: accountsStub, transactions: txStub, plaid_items: createQueryStub() } })
    const client = createPlaidStub()
    client.transactionsSync.mockResolvedValue({
      data: {
        added: [],
        modified: [
          { transaction_id: 'tx-1', account_id: 'pa-1', amount: 40, date: '2026-06-20', name: 'Groceries', personal_finance_category: { primary: 'FOOD_AND_DRINK' } },
        ],
        removed: [],
        next_cursor: 'cursor-1',
        has_more: false,
      },
    })

    const result = await syncPlaidItems(db as never, client as never, [makeItem({ user_id: 'user-1' })])

    expect(result.totals).toEqual({ added: 0, modified: 1, removed: 0 })
    // Modified rows go through update (not upsert) and the payload omits category.
    expect(txStub.update).toHaveBeenCalled()
    const updatePayload = txStub.update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('category')
    expect(updatePayload).toHaveProperty('amount')
  })
})
