import { describe, it, expect, vi } from 'vitest'
import { runSync, type SyncPage } from './sync'

describe('runSync', () => {
  it('loops until has_more is false, accumulating deltas and advancing the cursor', async () => {
    const pages: SyncPage<{ id: string }, { id: string }>[] = [
      {
        added: [{ id: 'a1' }, { id: 'a2' }],
        modified: [{ id: 'm1' }],
        removed: [{ transaction_id: 'r1' }],
        nextCursor: 'cursor-1',
        hasMore: true,
      },
      {
        added: [{ id: 'a3' }],
        modified: [],
        removed: [],
        nextCursor: 'cursor-2',
        hasMore: false,
      },
    ]
    const fetchPage = vi.fn(async (_cursor: string | null) => pages.shift()!)
    const apply = vi.fn(async () => {})

    const result = await runSync(null, fetchPage, apply)

    expect(result).toEqual({ added: 3, modified: 1, removed: 1, cursor: 'cursor-2' })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, null)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1')
    // First apply gets the first page's deltas with removed mapped to ids.
    expect(apply).toHaveBeenNthCalledWith(1, {
      added: [{ id: 'a1' }, { id: 'a2' }],
      modified: [{ id: 'm1' }],
      removedIds: ['r1'],
    })
  })

  it('handles a single empty page (no-op sync)', async () => {
    const fetchPage = vi.fn(async () => ({
      added: [],
      modified: [],
      removed: [],
      nextCursor: 'same-cursor',
      hasMore: false,
    }))
    const apply = vi.fn(async () => {})

    const result = await runSync('same-cursor', fetchPage, apply)

    expect(result).toEqual({ added: 0, modified: 0, removed: 0, cursor: 'same-cursor' })
    expect(apply).toHaveBeenCalledOnce()
  })
})
