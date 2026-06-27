import type { Transaction } from '@/lib/types'
import { shiftMonth } from '@/lib/finance/month'

export interface CashflowMonth {
  month: string // 'YYYY-MM'
  income: number
  expense: number
  net: number
}

/** `count` 'YYYY-MM' strings ending at `current`, oldest first. */
export function trailingMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(current, i - (count - 1)))
}

/**
 * One CashflowMonth per entry in `months` (zero-filled when empty).
 * Income = Σ positive amounts; expense = Σ |negative amounts|; both exclude
 * Transfer transactions. net = income − expense.
 */
export function monthlyCashflow(
  transactions: Transaction[],
  months: string[],
): CashflowMonth[] {
  return months.map((month) => {
    let income = 0
    let expense = 0
    for (const t of transactions) {
      if (t.category === 'Transfer') continue
      if (!t.date.startsWith(`${month}-`)) continue
      if (t.amount > 0) income += t.amount
      else if (t.amount < 0) expense += -t.amount
    }
    return { month, income, expense, net: income - expense }
  })
}

/** Largest income/expense magnitude across rows, for y-axis scaling (min 1). */
export function cashflowDomain(rows: CashflowMonth[]): number {
  const max = Math.max(0, ...rows.flatMap((r) => [r.income, r.expense]))
  return max > 0 ? max : 1
}
