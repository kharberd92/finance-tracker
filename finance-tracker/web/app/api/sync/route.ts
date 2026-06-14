import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { decryptToken } from '@/lib/plaid/crypto'
import { mapAccount, mapTransaction, type PlaidAccountLike, type PlaidTxnLike } from '@/lib/plaid/map'
import { runSync, type SyncPage } from '@/lib/plaid/sync'
import type { PlaidItem } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = createPlaidClient()
    const { data: items } = await supabase.from('plaid_items').select('*')
    const totals = { added: 0, modified: 0, removed: 0 }

    for (const item of (items ?? []) as PlaidItem[]) {
      const accessToken = decryptToken(item.encrypted_access_token)

      // Refresh balances and upsert accounts so the id map is complete.
      const balances = await client.accountsBalanceGet({ access_token: accessToken })
      const accountRows = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
        mapAccount(a, user.id, item.id, item.institution_name),
      )
      if (accountRows.length > 0) {
        await supabase.from('accounts').upsert(accountRows, { onConflict: 'user_id,plaid_account_id' })
      }

      // Build plaid_account_id -> our account id map.
      const { data: ourAccounts } = await supabase
        .from('accounts')
        .select('id, plaid_account_id')
        .eq('item_id', item.id)
      const idMap: Record<string, string> = {}
      for (const row of (ourAccounts ?? []) as { id: string; plaid_account_id: string }[]) {
        idMap[row.plaid_account_id] = row.id
      }

      const result = await runSync<PlaidTxnLike, PlaidTxnLike>(
        item.sync_cursor ?? null,
        async (cursor) => {
          const resp = await client.transactionsSync({
            access_token: accessToken,
            ...(cursor ? { cursor } : {}),
          })
          const d = resp.data
          return {
            added: d.added as PlaidTxnLike[],
            modified: d.modified as PlaidTxnLike[],
            removed: d.removed as { transaction_id: string }[],
            nextCursor: d.next_cursor,
            hasMore: d.has_more,
          } satisfies SyncPage<PlaidTxnLike, PlaidTxnLike>
        },
        async ({ added, modified, removedIds }) => {
          // New transactions: insert with the mapped Plaid category.
          if (added.length > 0) {
            const rows = added.map((t) => mapTransaction(t, user.id, idMap))
            await supabase
              .from('transactions')
              .upsert(rows, { onConflict: 'user_id,plaid_transaction_id' })
          }
          // Existing transactions: update Plaid-owned fields but NOT category
          // (sticky category — preserves the user's re-categorization).
          for (const t of modified) {
            const row = mapTransaction(t, user.id, idMap)
            await supabase
              .from('transactions')
              .update({
                account_id: row.account_id,
                amount: row.amount,
                date: row.date,
                merchant_name: row.merchant_name,
              })
              .eq('user_id', user.id)
              .eq('plaid_transaction_id', row.plaid_transaction_id)
          }
          if (removedIds.length > 0) {
            await supabase
              .from('transactions')
              .delete()
              .eq('user_id', user.id)
              .in('plaid_transaction_id', removedIds)
          }
        },
      )

      await supabase.from('plaid_items').update({ sync_cursor: result.cursor }).eq('id', item.id)

      totals.added += result.added
      totals.modified += result.modified
      totals.removed += result.removed
    }

    return NextResponse.json(totals)
  } catch {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 502 })
  }
}
