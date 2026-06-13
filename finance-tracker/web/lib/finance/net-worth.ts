import type { Account, AccountType } from '@/lib/types'

const LIABILITY_TYPES: AccountType[] = ['credit']

/** Net worth = sum of asset balances minus sum of liability balances. */
export function netWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) =>
      LIABILITY_TYPES.includes(a.type)
        ? sum - a.current_balance
        : sum + a.current_balance,
    0,
  )
}
