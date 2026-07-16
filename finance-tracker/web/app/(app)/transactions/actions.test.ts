import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  saveManualTransaction,
  updateTransactionCategory,
  deleteManualTransaction,
  saveTransactionSplits,
  removeTransactionSplits,
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('saveManualTransaction', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: 'X', category: 'Groceries', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a missing merchant', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: '', category: 'Groceries', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a category not in the list', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: 'X', category: 'Nonsense', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('stores an expense as a negative amount with is_manual', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-02', merchant_name: 'Coffee', category: 'Food And Drink', amount: '4.50', type: 'expense' }),
    )
    expect(res.success).toBe(true)
    expect(txns.insert).toHaveBeenCalledOnce()
    const row = txns.insert.mock.calls[0][0] as Record<string, unknown>
    expect(row.amount).toBe(-4.5)
    expect(row.is_manual).toBe(true)
    expect(row.category).toBe('Food And Drink')
  })

  it('stores income as a positive amount', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    await saveManualTransaction(
      {},
      fd({ date: '2026-06-02', merchant_name: 'Paycheck', category: 'Income', amount: '2000', type: 'income' }),
    )
    expect((txns.insert.mock.calls[0][0] as Record<string, unknown>).amount).toBe(2000)
  })
})

describe('updateTransactionCategory', () => {
  it('updates only category and notes', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await updateTransactionCategory(
      {},
      fd({ id: '11111111-1111-1111-1111-111111111111', category: 'Travel', notes: 'trip' }),
    )
    expect(res.success).toBe(true)
    expect(txns.update).toHaveBeenCalledWith({ category: 'Travel', notes: 'trip' })
  })

  it('rejects a bad category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await updateTransactionCategory({}, fd({ id: 'x', category: 'Bogus', notes: '' }))
    expect(res.error).toBeTruthy()
  })
})

describe('deleteManualTransaction', () => {
  it('deletes filtered by is_manual = true', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await deleteManualTransaction('11111111-1111-1111-1111-111111111111')
    expect(res.success).toBe(true)
    expect(txns.delete).toHaveBeenCalled()
    expect(txns.eq).toHaveBeenCalledWith('is_manual', true)
  })
})

const TXN_ID = '11111111-1111-1111-1111-111111111111'

describe('saveTransactionSplits', () => {
  it('rejects fewer than two parts', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 100 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a part with an invalid category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Bogus', amount: 60 }, { category: 'Shopping', amount: 40 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects parts that do not sum to the parent amount', async () => {
    const txns = createQueryStub({ data: { amount: -100 }, error: null })
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 60 }, { category: 'Shopping', amount: 30 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('signs parts to the parent sign, inserts them, and flags the parent as Split', async () => {
    const txns = createQueryStub({ data: { amount: -100 }, error: null })
    const splits = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { transactions: txns, transaction_splits: splits } }) as never,
    )
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 60 }, { category: 'Shopping', amount: 40 }]) }),
    )
    expect(res.success).toBe(true)
    expect(splits.delete).toHaveBeenCalled()
    const inserted = splits.insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ transaction_id: TXN_ID, category: 'Groceries', amount: -60 })
    expect(inserted[1]).toMatchObject({ category: 'Shopping', amount: -40 })
    expect(txns.update).toHaveBeenCalledWith({ category: 'Split' })
  })
})

describe('removeTransactionSplits', () => {
  it('deletes the parts and reverts the parent to Uncategorized', async () => {
    const txns = createQueryStub()
    const splits = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { transactions: txns, transaction_splits: splits } }) as never,
    )
    const res = await removeTransactionSplits(TXN_ID)
    expect(res.success).toBe(true)
    expect(splits.delete).toHaveBeenCalled()
    expect(txns.update).toHaveBeenCalledWith({ category: 'Uncategorized' })
  })
})
