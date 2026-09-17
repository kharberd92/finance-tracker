import type { Account } from '@/lib/types'

/** Account types whose balance is cash the user can actually spend. */
const SPENDABLE_TYPES: Account['type'][] = ['checking', 'savings']

/**
 * Cash available to spend: checking + savings only.
 *
 * Deliberately NOT `netWorth()`, which sums every account through
 * `isLiability`. The forecast answers "how low does my cash get before the
 * next paycheck", and two account types would wreck that question:
 *
 * - **investment** — a 401k cannot be spent on rent. Counting it produces a
 *   forecast that never dips, which is worse than no forecast.
 * - **credit** — a card balance is debt, not a resource. Subtracting it would
 *   answer a net-worth question, and would double-count as soon as the card
 *   payment itself projects as a bill.
 *
 * The consequence is that card spending does not reduce projected cash until
 * its payment lands, so the curve runs optimistic for a card-heavy month. The
 * UI states that rather than modelling statement cycles.
 */
export function spendableCash(accounts: Account[]): number {
  return accounts
    .filter((a) => SPENDABLE_TYPES.includes(a.type))
    .reduce((sum, a) => sum + a.current_balance, 0)
}
