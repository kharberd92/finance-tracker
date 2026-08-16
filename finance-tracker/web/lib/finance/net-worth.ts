import type { Account, AccountType } from '@/lib/types'

const LIABILITY_TYPES: AccountType[] = ['credit']

/** True when an account's balance represents debt owed rather than value held. */
export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type)
}

/** Net worth = sum of asset balances minus sum of liability balances. */
export function netWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) => (isLiability(a.type) ? sum - a.current_balance : sum + a.current_balance),
    0,
  )
}
