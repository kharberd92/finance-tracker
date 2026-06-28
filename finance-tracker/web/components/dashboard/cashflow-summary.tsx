import { Card } from '@/components/ui/card'
import type { CashflowMonth } from '@/lib/finance/cashflow'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function CashflowSummary({ row }: { row: CashflowMonth }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase text-muted-foreground">This month — {row.month}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Income</p>
          <p className="font-semibold tabular-nums text-income">{usd(row.income)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Expenses</p>
          <p className="font-semibold tabular-nums text-expense">{usd(row.expense)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Net</p>
          <p className={`font-semibold tabular-nums ${row.net >= 0 ? 'text-income' : 'text-expense'}`}>
            {usd(row.net)}
          </p>
        </div>
      </div>
    </Card>
  )
}
