import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { nextDueDate, daysUntilDue, isPaid } from '@/lib/finance/bill'
import type { Bill } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function dueLabel(days: number | null): string {
  if (days === null) return ''
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'due today'
  return `in ${days}d`
}

export function BillsWidget({ bills, now }: { bills: Bill[]; now: Date }) {
  const upcoming = bills
    .filter((b) => !isPaid(b, now))
    .map((b) => ({ bill: b, due: nextDueDate(b, now), days: daysUntilDue(b, now) }))
    .filter((x) => x.due !== null)
    .sort((a, b) => a.due!.getTime() - b.due!.getTime())
    .slice(0, 5)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Upcoming bills</p>
        <Link href="/bills" className="text-xs font-medium text-primary hover:underline">View all →</Link>
      </div>
      {upcoming.length === 0 ? (
        <EmptyState title="No upcoming bills" hint="Add recurring bills to see what's due." />
      ) : (
        <ul className="space-y-2">
          {upcoming.map(({ bill, days }) => (
            <li key={bill.id} className="flex justify-between text-sm">
              <span>{bill.name}</span>
              <span className="text-muted-foreground">{usd(bill.amount)} · {dueLabel(days)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
