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
import type { Account, Transaction, Budget, Bill, Goal } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

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

  const rows = monthlyCashflow(transactions, months)
  const total = netWorth(accounts)
  const now = new Date()
  const [year, mon] = month.split('-').map(Number)

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <p className="text-xs uppercase text-muted-foreground">Net worth</p>
        <p className="text-3xl font-bold">
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </Card>

      <CashflowSummary row={rows[rows.length - 1]} />

      <CashflowChart rows={rows} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={transactions} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
      </div>
    </div>
  )
}
