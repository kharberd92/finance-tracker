/** One page returned by a transactionsSync call, generic over the added/modified item type. */
export interface SyncPage<TAdded, TModified> {
  added: TAdded[]
  modified: TModified[]
  removed: { transaction_id: string }[]
  nextCursor: string
  hasMore: boolean
}

export interface SyncResult {
  added: number
  modified: number
  removed: number
  cursor: string
}

/**
 * Drives a Plaid transactionsSync pagination loop without touching Plaid or
 * Supabase directly. `fetchPage` gets the current cursor and returns one page;
 * `apply` persists that page's deltas. Loops until `hasMore` is false, then
 * returns the totals and the final cursor.
 */
export async function runSync<TAdded, TModified>(
  initialCursor: string | null,
  fetchPage: (cursor: string | null) => Promise<SyncPage<TAdded, TModified>>,
  apply: (delta: { added: TAdded[]; modified: TModified[]; removedIds: string[] }) => Promise<void>,
): Promise<SyncResult> {
  let cursor = initialCursor
  let added = 0
  let modified = 0
  let removed = 0

  for (;;) {
    const page = await fetchPage(cursor)
    await apply({
      added: page.added,
      modified: page.modified,
      removedIds: page.removed.map((r) => r.transaction_id),
    })
    added += page.added.length
    modified += page.modified.length
    removed += page.removed.length
    cursor = page.nextCursor
    if (!page.hasMore) break
  }

  return { added, modified, removed, cursor: cursor ?? '' }
}
