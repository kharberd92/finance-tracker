'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { goalProgress, goalReached, monthlyPaceNeeded } from '@/lib/finance/goal'
import { GoalForm } from './goal-form'
import { ContributionForm } from './contribution-form'
import type { Goal } from '@/lib/types'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const monthYear = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

function todayIso(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

export function GoalsView({ goals }: { goals: Goal[] }) {
  const [editing, setEditing] = useState<Goal | null>(null)
  const [creating, setCreating] = useState(false)
  const [contributing, setContributing] = useState<Goal | null>(null)
  const today = todayIso()

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Goals</h1>
        <Button onClick={() => setCreating(true)}>+ Add goal</Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState title="No goals yet" hint="Set a savings goal and track your progress." />
      ) : (
        <div className="space-y-2">
          {goals.map((g) => {
            const pct = goalProgress(g.current_amount, g.target_amount)
            const reached = goalReached(g.current_amount, g.target_amount)
            const pace = monthlyPaceNeeded(g.current_amount, g.target_amount, g.target_date ?? null, today)
            const remaining = g.target_amount - g.current_amount
            return (
              <Card key={g.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setEditing(g)}
                  >
                    <span className="text-lg" aria-hidden>
                      {g.icon}
                    </span>
                    <span className="font-medium">{g.name}</span>
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {usd(g.current_amount)} of {usd(g.target_amount)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: g.color_hex }} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {reached
                      ? 'Reached 🎉'
                      : pace != null
                        ? `Save ~${usd(pace)}/mo to reach by ${monthYear(g.target_date!)}`
                        : `${usd(remaining)} to go`}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setContributing(g)}>
                    Add contribution
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <GoalForm
          key={editing?.id ?? 'new'}
          goal={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
      {contributing && (
        <ContributionForm goal={contributing} onClose={() => setContributing(null)} />
      )}
    </section>
  )
}
