import type { AccountType, Transaction } from '@/lib/types'
import { isLiability } from '@/lib/finance/net-worth'
import { trailingMonths } from '@/lib/finance/cashflow'

/** Last calendar day of a 'YYYY-MM' month, as 'YYYY-MM-DD'. */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0)) // day 0 of next month = last day of this one
  return d.toISOString().slice(0, 10)
}

/**
 * Reconstructs an account's past month-end balances by walking today's balance
 * backwards through its transactions.
 *
 * The direction inverts by account type. `current_balance` on a credit account
 * is positive debt owed, while `mapTransaction` stores any outflow as negative:
 *
 *   assets:      balance(d) = current - sum(txns after d)
 *   liabilities: balance(d) = current + sum(txns after d)
 *
 * A $50 expense means a checking balance was $50 higher before it; the same $50
 * card charge means the debt was $50 LOWER before it.
 *
 * Only the current partial month is excluded — the newest point returned is the
 * previous month's end. Results are approximate by nature: transactions cannot
 * explain market moves, interest, or balance-only adjustments, which is why
 * callers must mark these points `source='reconstructed'`.
 */
export function reconstructBalances(
  currentBalance: number,
  accountType: AccountType,
  transactions: Transaction[],
  months: number,
  today: string,
): { as_of: string; balance: number }[] {
  const currentYm = today.slice(0, 7)
  // trailingMonths includes the current (partial) month; drop it — its month-end
  // has not happened yet.
  const ends = trailingMonths(currentYm, months)
    .filter((ym) => ym !== currentYm)
    .map(monthEnd)

  const inWindow = transactions.filter((t) => t.date <= today)
  const sign = isLiability(accountType) ? 1 : -1

  return ends.map((as_of) => {
    const after = inWindow
      .filter((t) => t.date > as_of)
      .reduce((sum, t) => sum + t.amount, 0)
    return { as_of, balance: currentBalance + sign * after }
  })
}
