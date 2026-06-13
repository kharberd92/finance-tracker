import type { Transaction } from '@/lib/types'

/** True if an ISO 'YYYY-MM-DD' date falls in the given year and 1-based month. */
function isInMonth(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split('-').map(Number)
  return y === year && m === month
}

/** Total spent (positive number) in a category for a given year/month. Expenses are negative amounts. */
export function spentThisMonth(
  transactions: Transaction[],
  category: string,
  year: number,
  month: number,
): number {
  return transactions
    .filter(
      (t) =>
        t.category === category &&
        t.amount < 0 &&
        isInMonth(t.date, year, month),
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
}

/** Remaining budget; negative means over budget. */
export function budgetRemaining(monthlyLimit: number, spent: number): number {
  return monthlyLimit - spent
}
