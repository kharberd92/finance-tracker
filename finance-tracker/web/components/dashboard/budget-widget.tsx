import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { spentThisMonth, budgetStatus } from '@/lib/finance/budget'
import type { Budget, Transaction } from '@/lib/types'

const STATUS_BAR = { under: 'bg-income', near: 'bg-amber-500', over: 'bg-expense' } as const
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function BudgetWidget({
  budgets,
  transactions,
  year,
  month,
}: {
  budgets: Budget[]
  transactions: Transaction[]
  year: number
  month: number
}) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Spent vs. budget</p>
        <Link href="/budgets" className="text-xs font-medium text-primary hover:underline">View all →</Link>
      </div>
      {budgets.length === 0 ? (
        <EmptyState title="No budgets yet" hint="Add a category budget to track spending." />
      ) : (
        <ul className="space-y-2">
          {budgets.slice(0, 5).map((b) => {
            const spent = spentThisMonth(transactions, b.category, year, month)
            const status = budgetStatus(spent, b.monthly_limit)
            const pct = b.monthly_limit > 0 ? Math.min(100, (spent / b.monthly_limit) * 100) : 100
            return (
              <li key={b.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{b.category}</span>
                  <span className="tabular-nums text-muted-foreground">{usd(spent)} / {usd(b.monthly_limit)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
