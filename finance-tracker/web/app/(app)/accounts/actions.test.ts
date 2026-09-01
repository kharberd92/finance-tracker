import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveBalanceHistory } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'
import { historyMonthEnds, HISTORY_MONTHS } from '@/lib/finance/net-worth-history'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

// The action reads the clock, so the valid grid has to be derived the same way
// rather than hardcoded.
const grid = historyMonthEnds(HISTORY_MONTHS, new Date().toISOString().slice(0, 10))
const monthEnd = grid[grid.length - 1]
const earlierMonthEnd = grid[grid.length - 2]

/** A mock whose `accounts` lookup resolves, plus the snapshots stub to assert on. */
function mockWithAccount() {
  const snapshots = createQueryStub()
  const accounts = createQueryStub({ data: { id: 'acct-1' }, error: null })
  mockedCreateClient.mockResolvedValue(
    createSupabaseMock({ tables: { accounts, account_balance_snapshots: snapshots } }) as never,
  )
  return snapshots
}

describe('saveBalanceHistory', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: 100 }])
    expect(res.error).toBeTruthy()
  })

  it('rejects a date that is not on the history grid', async () => {
    // An off-grid date cannot line up with a reconstructed point, so it would
    // create a date missing every other account instead of completing one.
    mockWithAccount()
    const res = await saveBalanceHistory('acct-1', [{ as_of: '2026-03-15', balance: 100 }])
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-finite balance', async () => {
    mockWithAccount()
    const res = await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: Number.NaN }])
    expect(res.error).toBeTruthy()
  })

  it('rejects an empty batch', async () => {
    mockWithAccount()
    expect((await saveBalanceHistory('acct-1', [])).error).toBeTruthy()
  })

  it('errors when the account belongs to someone else', async () => {
    const accounts = createQueryStub({ data: null, error: null })
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { accounts } }) as never)
    const res = await saveBalanceHistory('someone-elses', [{ as_of: monthEnd, balance: 100 }])
    expect(res.error).toBeTruthy()
  })

  it('writes entered balances as manual, on the account/date conflict key', async () => {
    const snapshots = mockWithAccount()
    const res = await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: 1234.56 }])
    expect(res.success).toBe(true)
    expect(snapshots.upsert).toHaveBeenCalledWith(
      [
        {
          user_id: 'user-1',
          account_id: 'acct-1',
          as_of: monthEnd,
          balance: 1234.56,
          source: 'manual',
        },
      ],
      { onConflict: 'account_id,as_of' },
    )
  })

  it('keeps a negative balance exactly as entered', async () => {
    // Sign correction would be its own lie: a credit account can genuinely
    // hold a negative (overpaid) balance.
    const snapshots = mockWithAccount()
    await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: -250 }])
    expect(snapshots.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ balance: -250 })],
      expect.anything(),
    )
  })

  it('clears blanked cells and writes the rest in one batch', async () => {
    const snapshots = mockWithAccount()
    const res = await saveBalanceHistory('acct-1', [
      { as_of: earlierMonthEnd, balance: null },
      { as_of: monthEnd, balance: 500 },
    ])
    expect(res.success).toBe(true)
    expect(snapshots.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ as_of: monthEnd, balance: 500 })],
      expect.anything(),
    )
    expect(snapshots.delete).toHaveBeenCalled()
    expect(snapshots.in).toHaveBeenCalledWith('as_of', [earlierMonthEnd])
  })

  it('scopes the clear to manual rows so an observed capture survives', async () => {
    const snapshots = mockWithAccount()
    await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: null }])
    expect(snapshots.eq).toHaveBeenCalledWith('source', 'manual')
  })

  it('does not upsert when every cell was cleared', async () => {
    const snapshots = mockWithAccount()
    await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: null }])
    expect(snapshots.upsert).not.toHaveBeenCalled()
  })

  it('does not delete when nothing was cleared', async () => {
    const snapshots = mockWithAccount()
    await saveBalanceHistory('acct-1', [{ as_of: monthEnd, balance: 10 }])
    expect(snapshots.delete).not.toHaveBeenCalled()
  })
})
