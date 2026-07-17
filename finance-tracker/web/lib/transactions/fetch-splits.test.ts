import { describe, it, expect } from 'vitest'
import { fetchSplitsFor } from './fetch-splits'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

describe('fetchSplitsFor', () => {
  it('returns [] without querying when there are no ids', async () => {
    const splits = createQueryStub()
    const supabase = createSupabaseMock({ tables: { transaction_splits: splits } })
    const res = await fetchSplitsFor(supabase as never, [])
    expect(res).toEqual([])
    expect(splits.select).not.toHaveBeenCalled()
  })

  it('queries transaction_splits filtered by the ids', async () => {
    const rows = [{ id: 's1', user_id: 'u1', transaction_id: 't1', category: 'Groceries', amount: -60 }]
    const splits = createQueryStub({ data: rows, error: null })
    const supabase = createSupabaseMock({ tables: { transaction_splits: splits } })
    const res = await fetchSplitsFor(supabase as never, ['t1'])
    expect(res).toEqual(rows)
    expect(splits.in).toHaveBeenCalledWith('transaction_id', ['t1'])
  })
})
