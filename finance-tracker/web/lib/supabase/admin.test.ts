import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ from: vi.fn() })) }))

import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from './admin'

const createClientMock = vi.mocked(createClient)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

describe('createAdminClient', () => {
  it('constructs a supabase client with the service-role key and no session persistence', () => {
    createAdminClient()
    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    )
  })
})
