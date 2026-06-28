import { createAdminClient } from '@/lib/supabase/admin'
import { createPlaidClient } from '@/lib/plaid/client'
import { syncPlaidItems } from '@/lib/plaid/sync-items'
import type { PlaidItem } from '@/lib/types'

async function main() {
  const db = createAdminClient()
  const client = createPlaidClient()

  const { data: items, error } = await db.from('plaid_items').select('*')
  if (error) throw new Error(`Failed to load plaid_items: ${error.message}`)

  const result = await syncPlaidItems(db, client, (items ?? []) as PlaidItem[])

  console.log(
    `[daily-sync] items synced: ${result.itemsSynced}/${(items ?? []).length} · ` +
      `added ${result.totals.added}, modified ${result.totals.modified}, removed ${result.totals.removed}`,
  )
  for (const e of result.errors) {
    console.error(`[daily-sync] item ${e.itemId} failed: ${e.message}`)
  }
  // Non-zero exit if any item failed, so Task Scheduler surfaces the failure.
  if (result.errors.length > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('[daily-sync] fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
