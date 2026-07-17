import { createClient } from '@/lib/supabase/server'
import { monthBounds } from '@/lib/finance/month'
import { TransactionsView } from '@/components/transactions/transactions-view'
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import type { Account, Transaction, TransactionSplit } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth()
  const { start, end } = monthBounds(ym)

  const supabase = await createClient()
  const [{ data: txns }, { data: accts }] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .gte('date', start)
      .lt('date', end)
      .order('date', { ascending: false }),
    supabase.from('accounts').select('*').order('name'),
  ])

  const transactions = (txns ?? []) as Transaction[]
  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))

  return (
    <TransactionsView
      month={ym}
      transactions={transactions}
      splits={splits}
      accounts={(accts ?? []) as Account[]}
    />
  )
}
