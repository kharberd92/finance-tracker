import { createClient } from '@/lib/supabase/server'
import { monthBounds } from '@/lib/finance/month'
import { BudgetsView } from '@/components/budgets/budgets-view'
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import { explodeSplits } from '@/lib/finance/split'
import type { Budget, Transaction } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth()
  const { start, end } = monthBounds(ym)

  const supabase = await createClient()
  const [{ data: budgets }, { data: txns }] = await Promise.all([
    supabase.from('budgets').select('*').order('category'),
    supabase.from('transactions').select('*').gte('date', start).lt('date', end),
  ])

  const transactions = (txns ?? []) as Transaction[]
  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))
  const exploded = explodeSplits(transactions, splits)

  return (
    <BudgetsView
      month={ym}
      budgets={(budgets ?? []) as Budget[]}
      transactions={exploded}
    />
  )
}
