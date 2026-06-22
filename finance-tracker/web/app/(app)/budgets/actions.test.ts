import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveBudget, deleteBudget } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('saveBudget', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '400' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-spending category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveBudget({}, fd({ category: 'Income', monthly_limit: '400' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-positive limit', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '0' }))
    expect(res.error).toBeTruthy()
  })

  it('upserts on conflict user_id,category for valid input', async () => {
    const budgets = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { budgets } }) as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '400' }))
    expect(res.success).toBe(true)
    expect(budgets.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Groceries', monthly_limit: 400 }),
      { onConflict: 'user_id,category' },
    )
  })
})

describe('deleteBudget', () => {
  it('deletes by id', async () => {
    const budgets = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { budgets } }) as never)
    const res = await deleteBudget('11111111-1111-1111-1111-111111111111')
    expect(res.success).toBe(true)
    expect(budgets.delete).toHaveBeenCalled()
    expect(budgets.eq).toHaveBeenCalledWith('id', '11111111-1111-1111-1111-111111111111')
  })
})
