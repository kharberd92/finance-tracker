import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveBill, setBillPaid, deleteBill } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

const valid = {
  name: 'Rent',
  amount: '1200',
  category: 'Bills & Utilities',
  frequency: 'monthly',
  due_day: '1',
}

describe('saveBill', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    expect((await saveBill({}, fd(valid))).error).toBeTruthy()
  })

  it('rejects empty name, non-positive amount, and non-spending category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveBill({}, fd({ ...valid, name: '' }))).error).toBeTruthy()
    expect((await saveBill({}, fd({ ...valid, amount: '0' }))).error).toBeTruthy()
    expect((await saveBill({}, fd({ ...valid, category: 'Income' }))).error).toBeTruthy()
  })

  it('rejects quarterly/yearly without a due_month', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveBill({}, fd({ ...valid, frequency: 'quarterly', due_day: '15' }))).error).toBeTruthy()
  })

  it('inserts on create with due_month null for monthly', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await saveBill({}, fd(valid))
    expect(res.success).toBe(true)
    expect(bills.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', name: 'Rent', frequency: 'monthly', amount: 1200, due_month: null }),
    )
  })

  it('inserts quarterly with the chosen due_month', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await saveBill({}, fd({ ...valid, frequency: 'quarterly', due_day: '15', due_month: '1' }))
    expect(res.success).toBe(true)
    expect(bills.insert).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'quarterly', due_month: 1 }))
  })

  it('updates on edit (id present)', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await saveBill({}, fd({ ...valid, id }))
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rent' }))
    expect(bills.eq).toHaveBeenCalledWith('id', id)
    expect(bills.insert).not.toHaveBeenCalled()
  })
})

describe('setBillPaid', () => {
  it('sets last_paid_date to a date string when paying', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await setBillPaid('bill-1', true)
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith({ last_paid_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(bills.eq).toHaveBeenCalledWith('id', 'bill-1')
  })

  it('clears last_paid_date when un-paying', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await setBillPaid('bill-1', false)
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith({ last_paid_date: null })
  })
})

describe('deleteBill', () => {
  it('deletes by id', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await deleteBill('bill-9')
    expect(res.success).toBe(true)
    expect(bills.delete).toHaveBeenCalled()
    expect(bills.eq).toHaveBeenCalledWith('id', 'bill-9')
  })
})
