import type { Bill, Transaction } from '@/lib/types'
import { monthlyCost } from '@/lib/finance/bill'

/**
 * Categories excluded from variable spend: Transfer (not spending) and
 * Bills & Utilities (fixed costs flowing through as transactions —
 * counting them would double-count the bills-based committed figure).
 */
const FIXED_FLOW_CATEGORIES = ['Transfer', 'Bills & Utilities']

const toCents = (n: number) => Math.round(n * 100) / 100

/** Total committed recurring cost across bills, normalized to $/mo. */
export function totalCommittedMonthly(bills: Bill[]): number {
  return toCents(bills.reduce((sum, b) => sum + monthlyCost(b), 0))
}

/**
 * Actual discretionary spend for `month` ('YYYY-MM'): the sum of expense
 * magnitudes, excluding FIXED_FLOW_CATEGORIES. Callers pass exploded rows
 * so a split's parts are judged per-part.
 */
export function variableSpend(transactions: Transaction[], month: string): number {
  let sum = 0
  for (const t of transactions) {
    if (t.amount >= 0) continue
    if (!t.date.startsWith(`${month}-`)) continue
    if (FIXED_FLOW_CATEGORIES.includes(t.category)) continue
    sum += -t.amount
  }
  return toCents(sum)
}

/** Committed as a whole percent of income, or null when there is no income. */
export function committedShareOfIncome(committed: number, income: number): number | null {
  if (income <= 0) return null
  return Math.round((committed / income) * 100)
}
