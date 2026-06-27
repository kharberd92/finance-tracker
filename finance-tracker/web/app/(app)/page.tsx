import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { trailingMonths, monthlyCashflow } from '@/lib/finance/cashflow'
import { Card } from '@/components/ui/card'
import { CashflowSummary } from '@/components/dashboard/cashflow-summary'
import type { Account, Transaction } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function DashboardPage() {
  const month = currentMonth()
  const months = trailingMonths(month, 12)
  const windowStart = `${months[0]}-01`

  const supabase = await createClient()
  const [accountsRes, txnsRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase
      .from('transactions')
      .select('*')
      .gte('date', windowStart)
      .order('date', { ascending: false }),
  ])
  const accounts = (accountsRes.data ?? []) as Account[]
  const transactions = (txnsRes.data ?? []) as Transaction[]

  const rows = monthlyCashflow(transactions, months)
  const total = netWorth(accounts)

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <p className="text-xs uppercase text-muted-foreground">Net worth</p>
        <p className="text-3xl font-bold">
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </Card>

      <CashflowSummary row={rows[rows.length - 1]} />
    </div>
  )
}
