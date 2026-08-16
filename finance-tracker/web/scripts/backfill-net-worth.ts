import { createAdminClient } from '@/lib/supabase/admin'
import { reconstructBalances } from '@/lib/finance/net-worth-history'
import type { Account, Transaction } from '@/lib/types'

const MONTHS = 13 // matches the recurring detector's window; gives a YoY read

/**
 * One-time backfill: reconstructs 13 months of month-end balances from
 * transaction history and writes them as source='reconstructed'.
 *
 * Idempotent and non-destructive. Upserts on (account_id, as_of), and skips any
 * date at or after an account's first OBSERVED snapshot so real data is never
 * overwritten by an estimate.
 */
async function main() {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: accountData, error: accountError } = await db.from('accounts').select('*')
  if (accountError) throw new Error(`Failed to load accounts: ${accountError.message}`)
  const accounts = (accountData ?? []) as Account[]

  const { data: txnData, error: txnError } = await db.from('transactions').select('*')
  if (txnError) throw new Error(`Failed to load transactions: ${txnError.message}`)
  const transactions = (txnData ?? []) as Transaction[]

  // Earliest observed snapshot per account — the boundary estimates must not cross.
  const { data: observedData, error: observedError } = await db
    .from('account_balance_snapshots')
    .select('account_id, as_of')
    .eq('source', 'observed')
    .order('as_of', { ascending: true })
  if (observedError) throw new Error(`Failed to load observed snapshots: ${observedError.message}`)

  const firstObserved = new Map<string, string>()
  for (const row of (observedData ?? []) as { account_id: string; as_of: string }[]) {
    if (!firstObserved.has(row.account_id)) firstObserved.set(row.account_id, row.as_of)
  }

  let written = 0
  let skipped = 0

  for (const account of accounts) {
    const mine = transactions.filter((t) => t.account_id === account.id)
    const points = reconstructBalances(
      account.current_balance,
      account.type,
      mine,
      MONTHS,
      today,
    )

    const boundary = firstObserved.get(account.id)
    const eligible = boundary ? points.filter((p) => p.as_of < boundary) : points
    skipped += points.length - eligible.length
    if (eligible.length === 0) continue

    const rows = eligible.map((p) => ({
      user_id: account.user_id,
      account_id: account.id,
      as_of: p.as_of,
      balance: p.balance,
      source: 'reconstructed' as const,
    }))

    const { error } = await db
      .from('account_balance_snapshots')
      .upsert(rows, { onConflict: 'account_id,as_of' })
    if (error) throw new Error(`Failed to write backfill for ${account.name}: ${error.message}`)

    written += rows.length
    console.log(`[backfill] ${account.name}: ${rows.length} reconstructed points`)
  }

  console.log(`[backfill] done — ${written} rows written, ${skipped} skipped (observed data wins)`)
}

main().catch((err) => {
  console.error(`[backfill] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
