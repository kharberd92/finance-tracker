import { createAdminClient } from '@/lib/supabase/admin'
import { reconstructBalances } from '@/lib/finance/net-worth-history'
import type { Account, Transaction } from '@/lib/types'

const MONTHS = 13 // matches the recurring detector's window; gives a YoY read

/**
 * One-time backfill: reconstructs 13 months of month-end balances from
 * transaction history and writes them as source='reconstructed'.
 *
 * Idempotent and non-destructive. Upserts on (account_id, as_of), and skips any
 * cell already held by real data — observed OR manual — so an estimate never
 * overwrites a measurement or a balance the user attested to.
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

  // Every cell already held by real data. Manual entries are scattered
  // month-ends rather than a contiguous recent run, so an "at or after the
  // first observed snapshot" boundary is the wrong shape for them — one
  // hand-entered balance from a year ago would fence off the whole year.
  // Exclude the exact cells instead.
  const { data: realData, error: realError } = await db
    .from('account_balance_snapshots')
    .select('account_id, as_of')
    .neq('source', 'reconstructed')
  if (realError) throw new Error(`Failed to load existing snapshots: ${realError.message}`)

  const cell = (accountId: string, asOf: string) => `${accountId}|${asOf}`
  const taken = new Set(
    ((realData ?? []) as { account_id: string; as_of: string }[]).map((r) =>
      cell(r.account_id, r.as_of),
    ),
  )

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

    const eligible = points.filter((p) => !taken.has(cell(account.id, p.as_of)))
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

  console.log(`[backfill] done — ${written} rows written, ${skipped} skipped (real data wins)`)
}

main().catch((err) => {
  console.error(`[backfill] ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
})
