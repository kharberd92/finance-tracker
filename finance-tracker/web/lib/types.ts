export type AccountType = 'checking' | 'savings' | 'credit' | 'investment'

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  current_balance: number
  institution_name: string
  plaid_account_id?: string | null
  item_id?: string | null
}

export interface Transaction {
  id: string
  user_id: string
  account_id?: string | null
  amount: number // negative = expense, positive = income
  date: string // ISO 'YYYY-MM-DD'
  merchant_name: string
  category: string
  notes?: string | null
  is_manual: boolean
  plaid_transaction_id?: string | null
}

export interface TransactionSplit {
  id: string
  user_id: string
  transaction_id: string
  category: string
  amount: number // same sign as parent (negative = expense)
}

export interface Budget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
}

export type BillFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Bill {
  id: string
  user_id: string
  name: string
  amount: number
  due_day: number // monthly/quarterly/yearly: day-of-month 1–31; weekly: day-of-week 0–6 (Sun=0)
  due_month?: number | null // 1–12 anchor for quarterly/yearly; null/unused otherwise
  frequency: BillFrequency
  category: string
  last_paid_date?: string | null // ISO 'YYYY-MM-DD'; null = unpaid this cycle
  merchant_name?: string | null // normalized merchant key; set when promoted from a detected candidate
}

export interface RecurringDismissal {
  id: string
  user_id: string
  merchant_name: string // normalized merchant key
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date?: string | null
  icon: string
  color_hex: string
}

export interface PlaidItem {
  id: string
  user_id: string
  plaid_item_id: string
  encrypted_access_token: string
  sync_cursor?: string | null
  institution_name: string
  last_synced_at?: string | null
}
