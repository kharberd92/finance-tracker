import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { trailingMonths, monthlyCashflow } from '@/lib/finance/cashflow'
import { Card } from '@/components/ui/card'
import { CashflowSummary } from '@/components/dashboard/cashflow-summary'
import { CashflowChart } from '@/components/dashboard/cashflow-chart'
import { BudgetWidget } from '@/components/dashboard/budget-widget'
import { GoalsWidget } from '@/components/dashboard/goals-widget'
import { BillsWidget } from '@/components/dashboard/bills-widget'
import { RecentTransactionsWidget } from '@/components/dashboard/recent-transactions-widget'
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import { explodeSplits } from '@/lib/finance/split'
import type { Account, Transaction, Budget, Bill, Goal } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function DashboardPage() {
  const month = currentMonth()
  const months = trailingMonths(month, 12)
  const windowStart = `${months[0]}-01`

  const supabase = await createClient()
  const [accountsRes, txnsRes, budgetsRes, billsRes, goalsRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase
      .from('transactions')
      .select('*')
      .gte('date', windowStart)
      .order('date', { ascending: false }),
    supabase.from('budgets').select('*').order('category'),
    supabase.from('bills').select('*'),
    supabase.from('goals').select('*').order('name'),
  ])
  const accounts = (accountsRes.data ?? []) as Account[]
  const transactions = (txnsRes.data ?? []) as Transaction[]
  const budgets = (budgetsRes.data ?? []) as Budget[]
  const bills = (billsRes.data ?? []) as Bill[]
  const goals = (goalsRes.data ?? []) as Goal[]

  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))
  const exploded = explodeSplits(transactions, splits)

  const rows = monthlyCashflow(exploded, months)
  const total = netWorth(accounts)
  const now = new Date()
  const [year, mon] = month.split('-').map(Number)

  const lastNet = rows[rows.length - 1]?.net ?? 0
  const netLabel =
    lastNet >= 0 ? `▲ this month +${usd(lastNet)}` : `▼ this month ${usd(Math.abs(lastNet))}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.3fr_2fr]">
        <Card className="p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Net worth</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
          <span
            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
              lastNet >= 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense'
            }`}
          >
            {netLabel}
          </span>
        </Card>

        <CashflowSummary row={rows[rows.length - 1]} />
      </div>

      <CashflowChart rows={rows} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={exploded} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
      </div>
    </div>
  )
}
