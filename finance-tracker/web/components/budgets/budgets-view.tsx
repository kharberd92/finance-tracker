'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { spentThisMonth, budgetRemaining, budgetStatus } from '@/lib/finance/budget'
import { shiftMonth } from '@/lib/finance/month'
import { BudgetForm } from './budget-form'
import type { Budget, Transaction } from '@/lib/types'

const STATUS_BAR: Record<'under' | 'near' | 'over', string> = {
  under: 'bg-green-600',
  near: 'bg-amber-500',
  over: 'bg-red-600',
}
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function BudgetsView({
  month,
  budgets,
  transactions,
}: {
  month: string
  budgets: Budget[]
  transactions: Transaction[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Budget | null>(null)
  const [creating, setCreating] = useState(false)
  const [year, mon] = month.split('-').map(Number)
  const budgetedCategories = budgets.map((b) => b.category)

  function gotoMonth(delta: number) {
    router.push(`/budgets?month=${shiftMonth(month, delta)}`)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Budgets</h1>
        <Button onClick={() => setCreating(true)}>+ Add budget</Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => gotoMonth(-1)}>
          ←
        </Button>
        <span className="min-w-24 text-center text-sm font-medium">{month}</span>
        <Button variant="outline" size="sm" onClick={() => gotoMonth(1)}>
          →
        </Button>
      </div>

      {budgets.length === 0 ? (
        <EmptyState title="No budgets yet" hint="Add a category budget to track your spending." />
      ) : (
        <div className="space-y-2">
          {budgets.map((b) => {
            const spent = spentThisMonth(transactions, b.category, year, mon)
            const remaining = budgetRemaining(b.monthly_limit, spent)
            const status = budgetStatus(spent, b.monthly_limit)
            const pct = b.monthly_limit > 0 ? Math.min(100, (spent / b.monthly_limit) * 100) : 100
            return (
              <Card
                key={b.id}
                className="cursor-pointer space-y-2 p-4"
                onClick={() => setEditing(b)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{b.category}</span>
                  <span className="text-sm text-muted-foreground">
                    {usd(spent)} of {usd(b.monthly_limit)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`text-xs ${status === 'over' ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {remaining >= 0 ? `${usd(remaining)} left` : `${usd(-remaining)} over`}
                </p>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <BudgetForm
          budget={editing}
          budgetedCategories={budgetedCategories}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}
