import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'
import { encryptToken } from '@/lib/plaid/crypto'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('POST /api/sync', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('syncs one item: writes transactions, refreshes accounts, saves cursor', async () => {
    const itemsStub = createQueryStub({
      data: [
        {
          id: 'item-1',
          user_id: 'user-1',
          plaid_item_id: 'plaid-item-1',
          encrypted_access_token: encryptToken('access-sandbox-1'),
          sync_cursor: null,
          institution_name: 'Chase',
        },
      ],
      error: null,
    })
    // accounts: after upsert, a select returns our account rows for the id map.
    const accountsStub = createQueryStub({
      data: [{ id: 'our-acct-1', plaid_account_id: 'pa-1' }],
      error: null,
    })
    const txStub = createQueryStub()

    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({
        tables: { plaid_items: itemsStub, accounts: accountsStub, transactions: txStub },
      }) as never,
    )

    mockedCreatePlaid.mockReturnValue({
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 500 } },
          ],
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [
            {
              transaction_id: 'ptxn-1',
              account_id: 'pa-1',
              amount: 40,
              date: '2026-06-02',
              name: 'Groceries',
              merchant_name: 'Trader Joe’s',
              personal_finance_category: { primary: 'FOOD_AND_DRINK' },
            },
          ],
          modified: [],
          removed: [],
          next_cursor: 'cursor-final',
          has_more: false,
        },
      }),
    } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ added: 1, modified: 0, removed: 0 })

    // Transactions upserted, accounts refreshed, cursor saved on the item.
    expect(txStub.upsert).toHaveBeenCalled()
    expect(accountsStub.upsert).toHaveBeenCalled()
    expect(itemsStub.update).toHaveBeenCalledWith(
      expect.objectContaining({ sync_cursor: 'cursor-final' }),
    )
  })

  it('returns 502 when the only item fails to sync (no item synced)', async () => {
    const itemsStub = createQueryStub({
      data: [
        {
          id: 'item-1',
          user_id: 'user-1',
          plaid_item_id: 'plaid-item-1',
          encrypted_access_token: encryptToken('access-sandbox-1'),
          sync_cursor: null,
          institution_name: 'Chase',
        },
      ],
      error: null,
    })

    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({
        tables: { plaid_items: itemsStub, accounts: createQueryStub(), transactions: createQueryStub() },
      }) as never,
    )

    mockedCreatePlaid.mockReturnValue({
      // The item's first Plaid call throws, so the item fails and nothing syncs.
      accountsBalanceGet: vi.fn().mockRejectedValue(new Error('plaid down')),
      transactionsSync: vi.fn(),
    } as never)

    const res = await POST()
    expect(res.status).toBe(502)
  })

  it('updates Plaid fields but not category for modified transactions (sticky category)', async () => {
    const itemsStub = createQueryStub({
      data: [
        {
          id: 'item-1',
          user_id: 'user-1',
          plaid_item_id: 'plaid-item-1',
          encrypted_access_token: encryptToken('access-sandbox-1'),
          sync_cursor: 'cursor-prev',
          institution_name: 'Chase',
        },
      ],
      error: null,
    })
    const accountsStub = createQueryStub({
      data: [{ id: 'our-acct-1', plaid_account_id: 'pa-1' }],
      error: null,
    })
    const txStub = createQueryStub()

    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({
        tables: { plaid_items: itemsStub, accounts: accountsStub, transactions: txStub },
      }) as never,
    )

    mockedCreatePlaid.mockReturnValue({
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 500 } },
          ],
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [],
          modified: [
            {
              transaction_id: 'ptxn-1',
              account_id: 'pa-1',
              amount: 40,
              date: '2026-06-02',
              name: 'Groceries',
              merchant_name: 'Trader Joe’s',
              personal_finance_category: { primary: 'FOOD_AND_DRINK' },
            },
          ],
          removed: [],
          next_cursor: 'cursor-final',
          has_more: false,
        },
      }),
    } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ added: 0, modified: 1, removed: 0 })

    // Modified path uses update, not upsert, and the update payload omits category.
    expect(txStub.update).toHaveBeenCalled()
    const updatePayload = txStub.update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('category')
    expect(updatePayload).toHaveProperty('amount')
    expect(txStub.upsert).not.toHaveBeenCalled()
  })
})
