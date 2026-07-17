import type { SupabaseClient } from '@supabase/supabase-js'
import type { TransactionSplit } from '@/lib/types'

/** Splits belonging to the given transaction ids (RLS scopes them to the current user). */
export async function fetchSplitsFor(
  supabase: SupabaseClient,
  transactionIds: string[],
): Promise<TransactionSplit[]> {
  if (transactionIds.length === 0) return []
  const { data } = await supabase
    .from('transaction_splits')
    .select('*')
    .in('transaction_id', transactionIds)
  return (data ?? []) as TransactionSplit[]
}
