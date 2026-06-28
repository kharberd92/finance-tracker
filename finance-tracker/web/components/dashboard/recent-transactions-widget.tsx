import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import type { Transaction } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function RecentTransactionsWidget({ transactions }: { transactions: Transaction[] }) {
  // The page already fetches transactions ordered by date descending.
  const recent = transactions.slice(0, 5)
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Recent transactions</p>
        <Link href="/transactions" className="text-sm text-muted-foreground hover:text-foreground">→</Link>
      </div>
      {recent.length === 0 ? (
        <EmptyState title="No transactions yet" hint="Connect a bank or add one manually." />
      ) : (
        <ul className="space-y-2">
          {recent.map((t) => (
            <li key={t.id} className="flex justify-between text-sm">
              <span className="truncate">{t.merchant_name}</span>
              <span className="flex shrink-0 gap-2">
                <span className={`tabular-nums ${t.amount < 0 ? 'text-expense' : 'text-income'}`}>{usd(t.amount)}</span>
                <span className="text-muted-foreground">{t.date.slice(5)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
