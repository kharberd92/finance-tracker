import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { goalProgress } from '@/lib/finance/goal'
import type { Goal } from '@/lib/types'

export function GoalsWidget({ goals }: { goals: Goal[] }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Goals progress</p>
        <Link href="/goals" className="text-xs font-medium text-primary hover:underline">View all →</Link>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="No goals yet" hint="Create a savings goal to start tracking." />
      ) : (
        <ul className="space-y-2">
          {goals.slice(0, 5).map((g) => {
            const pct = goalProgress(g.current_amount, g.target_amount)
            return (
              <li key={g.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{g.icon} {g.name}</span>
                  <span className="text-muted-foreground">{Math.round(pct)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: g.color_hex }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
