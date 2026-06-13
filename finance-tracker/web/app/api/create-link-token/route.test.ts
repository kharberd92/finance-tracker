import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/create-link-token', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns a link token on success', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const linkTokenCreate = vi.fn().mockResolvedValue({ data: { link_token: 'link-sandbox-1' } })
    mockedCreatePlaid.mockReturnValue({ linkTokenCreate } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ linkToken: 'link-sandbox-1' })
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'user-1' } }),
    )
  })

  it('returns 502 when Plaid fails', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    mockedCreatePlaid.mockReturnValue({
      linkTokenCreate: vi.fn().mockRejectedValue(new Error('plaid down')),
    } as never)

    const res = await POST()
    expect(res.status).toBe(502)
  })
})
