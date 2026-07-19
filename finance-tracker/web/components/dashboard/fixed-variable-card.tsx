import Link from 'next/link'
import { Card } from '@/components/ui/card'
import {
  totalCommittedMonthly,
  variableSpend,
  committedShareOfIncome,
} from '@/lib/finance/fixed-variable'
import type { Bill, Transaction } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function FixedVariableCard({
  bills,
  transactions,
  month,
  income,
}: {
  bills: Bill[]
  transactions: Transaction[] // exploded rows
  month: string // 'YYYY-MM'
  income: number
}) {
  const committed = totalCommittedMonthly(bills)
  const variable = variableSpend(transactions, month)
  const share = committedShareOfIncome(committed, income)
  const total = committed + variable
  const fixedPct = total > 0 ? (committed / total) * 100 : 0
  const variablePct = total > 0 ? 100 - fixedPct : 0
  const fixedPctRounded = Math.round(fixedPct)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Fixed vs. variable</p>
        <Link href="/bills" className="text-xs font-medium text-primary hover:underline">
          Manage bills →
        </Link>
      </div>

      <div className="flex gap-8">
        <div>
          <p className="text-xl font-bold tabular-nums">
            {usd(committed)}
            <span className="text-sm font-medium text-muted-foreground">/mo</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Committed ({bills.length} {bills.length === 1 ? 'bill' : 'bills'})
          </p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{usd(variable)}</p>
          <p className="text-xs text-muted-foreground">Variable this month</p>
        </div>
      </div>

      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${fixedPct}%` }} />
        <div className="h-full bg-primary/40" style={{ width: `${variablePct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-primary" />
          Committed {fixedPctRounded}%
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-primary/40" />
          Variable {total > 0 ? 100 - fixedPctRounded : 0}%
        </span>
      </div>

      {share !== null && (
        <p className="text-xs text-muted-foreground">
          Committed costs are{' '}
          <span className="font-medium text-foreground">{share}%</span> of this
          month&apos;s income
        </p>
      )}
    </Card>
  )
}
