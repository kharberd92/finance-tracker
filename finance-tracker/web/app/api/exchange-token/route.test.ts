import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

function req(body: unknown): Request {
  return new Request('http://localhost/api/exchange-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('POST /api/exchange-token', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST(req({ publicToken: 'public-sandbox-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when publicToken is missing', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await POST(req({ institutionName: 'Chase' }))
    expect(res.status).toBe(400)
  })

  it('stores an encrypted item and upserts accounts on success', async () => {
    const itemsStub = createQueryStub({ data: { id: 'item-row-1' }, error: null })
    const accountsStub = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { plaid_items: itemsStub, accounts: accountsStub } }) as never,
    )
    mockedCreatePlaid.mockReturnValue({
      itemPublicTokenExchange: vi
        .fn()
        .mockResolvedValue({ data: { access_token: 'access-sandbox-1', item_id: 'plaid-item-1' } }),
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } },
          ],
        },
      }),
    } as never)

    const res = await POST(req({ publicToken: 'public-sandbox-1', institutionName: 'Chase' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, accountCount: 1 })

    // An item row was inserted, and the stored token is NOT the plaintext.
    expect(itemsStub.insert).toHaveBeenCalledOnce()
    const inserted = itemsStub.insert.mock.calls[0][0] as { encrypted_access_token: string }
    expect(inserted.encrypted_access_token).not.toContain('access-sandbox-1')
    expect(accountsStub.upsert).toHaveBeenCalledOnce()
  })

  it('returns 502 when Plaid fails', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    mockedCreatePlaid.mockReturnValue({
      itemPublicTokenExchange: vi.fn().mockRejectedValue(new Error('plaid down')),
    } as never)
    const res = await POST(req({ publicToken: 'public-sandbox-1' }))
    expect(res.status).toBe(502)
  })
})
