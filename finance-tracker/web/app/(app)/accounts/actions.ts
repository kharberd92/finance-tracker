'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { historyMonthEnds, HISTORY_MONTHS } from '@/lib/finance/net-worth-history'

export type ActionState = { error?: string; success?: boolean }

const entrySchema = z.object({
  as_of: z.string(),
  /** null clears the cell. */
  balance: z.number().finite().nullable(),
})

const payloadSchema = z.object({
  accountId: z.string().min(1),
  entries: z.array(entrySchema).min(1, 'Nothing to save'),
})

export type BalanceHistoryEntry = z.infer<typeof entrySchema>

/**
 * Records the balances a user read off their statements as `manual` snapshots.
 *
 * Manual rows are real data — they rank with observed captures for charting —
 * but they are stored under their own provenance so the daily capture and the
 * backfill can recognize them and leave them alone.
 *
 * Two rules do the safety work here:
 *
 * - **Dates must be on the grid.** An `as_of` outside `historyMonthEnds` cannot
 *   line up with a reconstructed point, so it would create a date missing every
 *   other account rather than completing one. That is a bug in the caller, not
 *   a value to store.
 * - **Only `manual` rows are cleared.** Blanking a field removes a balance the
 *   user entered; it must never delete an observed capture, which is a
 *   measurement this page has no business editing.
 */
export async function saveBalanceHistory(
  accountId: string,
  entries: BalanceHistoryEntry[],
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = payloadSchema.safeParse({ accountId, entries })
  if (!parsed.success) return { error: parsed.error.issues[0].message ?? 'Those balances are not valid.' }

  const today = new Date().toISOString().slice(0, 10)
  const grid = new Set(historyMonthEnds(HISTORY_MONTHS, today))
  if (parsed.data.entries.some((e) => !grid.has(e.as_of))) {
    return { error: 'That is not a month-end this history covers.' }
  }

  // RLS would reject a write against someone else's account, but failing here
  // gives a real message instead of a database error.
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('id', parsed.data.accountId)
    .maybeSingle()
  if (!account) return { error: 'Could not find that account.' }

  const writes = parsed.data.entries.filter((e) => e.balance !== null)
  const clears = parsed.data.entries.filter((e) => e.balance === null).map((e) => e.as_of)

  if (writes.length > 0) {
    const { error } = await supabase.from('account_balance_snapshots').upsert(
      writes.map((e) => ({
        user_id: user.id,
        account_id: parsed.data.accountId,
        as_of: e.as_of,
        balance: e.balance as number,
        source: 'manual' as const,
      })),
      { onConflict: 'account_id,as_of' },
    )
    if (error) return { error: 'Could not save those balances.' }
  }

  if (clears.length > 0) {
    const { error } = await supabase
      .from('account_balance_snapshots')
      .delete()
      .eq('account_id', parsed.data.accountId)
      .eq('source', 'manual')
      .in('as_of', clears)
    if (error) return { error: 'Could not clear those balances.' }
  }

  revalidatePath('/accounts/history')
  revalidatePath('/')
  return { success: true }
}
