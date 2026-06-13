import type { AccountType } from '@/lib/types'

/** Minimal shape of the Plaid transaction fields we consume. */
export interface PlaidTxnLike {
  transaction_id: string
  account_id: string
  amount: number
  date: string
  name: string
  merchant_name?: string | null
  personal_finance_category?: { primary?: string | null } | null
}

/** Minimal shape of the Plaid account fields we consume. */
export interface PlaidAccountLike {
  account_id: string
  name: string
  type: string
  subtype: string | null
  balances: { current: number | null }
}

/** Row shape for an upsert into our `transactions` table. */
export interface MappedTransaction {
  user_id: string
  account_id: string | null
  amount: number
  date: string
  merchant_name: string
  category: string
  plaid_transaction_id: string
  is_manual: boolean
}

/** Row shape for an upsert into our `accounts` table. */
export interface MappedAccount {
  user_id: string
  item_id: string
  plaid_account_id: string
  name: string
  type: AccountType
  current_balance: number
  institution_name: string
}

/** Maps a Plaid account type/subtype to our enum. */
export function mapAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'credit' || type === 'loan') return 'credit'
  if (type === 'investment' || type === 'brokerage') return 'investment'
  if (type === 'depository') return subtype === 'savings' ? 'savings' : 'checking'
  return 'checking'
}

/** Title-cases a Plaid primary category (FOOD_AND_DRINK → Food And Drink). */
export function titleCaseCategory(primary: string | null | undefined): string {
  if (!primary) return 'Uncategorized'
  return primary
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Maps a Plaid transaction to our row. Plaid amounts are positive for outflow;
 * we store negative = expense, so the sign is flipped.
 */
export function mapTransaction(
  txn: PlaidTxnLike,
  userId: string,
  accountIdByPlaidId: Record<string, string>,
): MappedTransaction {
  return {
    user_id: userId,
    account_id: accountIdByPlaidId[txn.account_id] ?? null,
    amount: -txn.amount,
    date: txn.date,
    merchant_name: txn.merchant_name ?? txn.name,
    category: titleCaseCategory(txn.personal_finance_category?.primary),
    plaid_transaction_id: txn.transaction_id,
    is_manual: false,
  }
}

/** Maps a Plaid account to our row. */
export function mapAccount(
  account: PlaidAccountLike,
  userId: string,
  itemId: string,
  institutionName: string,
): MappedAccount {
  return {
    user_id: userId,
    item_id: itemId,
    plaid_account_id: account.account_id,
    name: account.name,
    type: mapAccountType(account.type, account.subtype),
    current_balance: account.balances.current ?? 0,
    institution_name: institutionName,
  }
}
