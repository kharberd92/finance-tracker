import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveGoal, addContribution, deleteGoal } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'
import { GOAL_ICONS, GOAL_COLORS } from '@/lib/finance/goal-presets'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

const valid = {
  name: 'Vacation',
  target_amount: '3000',
  current_amount: '0',
  icon: GOAL_ICONS[0],
  color_hex: GOAL_COLORS[0],
}

describe('saveGoal', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveGoal({}, fd(valid))
    expect(res.error).toBeTruthy()
  })

  it('rejects an empty name', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveGoal({}, fd({ ...valid, name: '' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-positive target', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveGoal({}, fd({ ...valid, target_amount: '0' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects an invalid icon or color', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveGoal({}, fd({ ...valid, icon: '🦄' }))).error).toBeTruthy()
    expect((await saveGoal({}, fd({ ...valid, color_hex: '#000000' }))).error).toBeTruthy()
  })

  it('inserts on create (no id)', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await saveGoal({}, fd(valid))
    expect(res.success).toBe(true)
    expect(goals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', name: 'Vacation', target_amount: 3000 }),
    )
    expect(goals.update).not.toHaveBeenCalled()
  })

  it('updates on edit (id present)', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await saveGoal({}, fd({ ...valid, id }))
    expect(res.success).toBe(true)
    expect(goals.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Vacation', target_amount: 3000 }),
    )
    expect(goals.eq).toHaveBeenCalledWith('id', id)
    expect(goals.insert).not.toHaveBeenCalled()
  })
})

describe('addContribution', () => {
  it('rejects a non-positive amount', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await addContribution('goal-1', 0)
    expect(res.error).toBeTruthy()
  })

  it('adds the amount to the current total', async () => {
    const goals = createQueryStub({ data: { current_amount: 100 }, error: null })
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await addContribution('goal-1', 500)
    expect(res.success).toBe(true)
    expect(goals.update).toHaveBeenCalledWith({ current_amount: 600 })
    expect(goals.eq).toHaveBeenCalledWith('id', 'goal-1')
  })
})

describe('deleteGoal', () => {
  it('deletes by id', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await deleteGoal('goal-9')
    expect(res.success).toBe(true)
    expect(goals.delete).toHaveBeenCalled()
    expect(goals.eq).toHaveBeenCalledWith('id', 'goal-9')
  })
})
