import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaidApi } from 'plaid'
import { decryptToken } from '@/lib/plaid/crypto'
import { mapAccount, mapTransaction, type PlaidAccountLike, type PlaidTxnLike } from '@/lib/plaid/map'
import { runSync, type SyncPage } from '@/lib/plaid/sync'
import type { PlaidItem } from '@/lib/types'

export type SyncTotals = { added: number; modified: number; removed: number }
export type SyncItemError = { itemId: string; message: string }
export type SyncResult = { totals: SyncTotals; errors: SyncItemError[]; itemsSynced: number }

/**
 * Syncs the given Plaid items into Supabase. Works with either a session client
 * (RLS, manual route) or a service-role client (headless script): it writes per
 * `item.user_id`, never a single ambient user. Each item is isolated — one
 * failure is recorded in `errors` and does not abort the rest.
 */
export async function syncPlaidItems(
  db: SupabaseClient,
  client: PlaidApi,
  items: PlaidItem[],
): Promise<SyncResult> {
  const totals: SyncTotals = { added: 0, modified: 0, removed: 0 }
  const errors: SyncItemError[] = []
  let itemsSynced = 0

  for (const item of items) {
    try {
      const accessToken = decryptToken(item.encrypted_access_token)

      // Refresh balances and upsert accounts so the id map is complete.
      const balances = await client.accountsBalanceGet({ access_token: accessToken })
      const accountRows = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
        mapAccount(a, item.user_id, item.id, item.institution_name),
      )
      if (accountRows.length > 0) {
        await db.from('accounts').upsert(accountRows, { onConflict: 'user_id,plaid_account_id' })
      }

      // Build plaid_account_id -> our account id map.
      const { data: ourAccounts } = await db
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
          if (added.length > 0) {
            const rows = added.map((t) => mapTransaction(t, item.user_id, idMap))
            await db.from('transactions').upsert(rows, { onConflict: 'user_id,plaid_transaction_id' })
          }
          // Sticky category: update Plaid-owned fields but NOT category.
          for (const t of modified) {
            const row = mapTransaction(t, item.user_id, idMap)
            await db
              .from('transactions')
              .update({
                account_id: row.account_id,
                amount: row.amount,
                date: row.date,
                merchant_name: row.merchant_name,
              })
              .eq('user_id', item.user_id)
              .eq('plaid_transaction_id', row.plaid_transaction_id)
          }
          if (removedIds.length > 0) {
            await db
              .from('transactions')
              .delete()
              .eq('user_id', item.user_id)
              .in('plaid_transaction_id', removedIds)
          }
        },
      )

      await db
        .from('plaid_items')
        .update({ sync_cursor: result.cursor, last_synced_at: new Date().toISOString() })
        .eq('id', item.id)

      totals.added += result.added
      totals.modified += result.modified
      totals.removed += result.removed
      itemsSynced += 1
    } catch (e) {
      errors.push({ itemId: item.id, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { totals, errors, itemsSynced }
}
