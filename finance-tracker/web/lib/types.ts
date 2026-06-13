export type AccountType = 'checking' | 'savings' | 'credit' | 'investment'

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  current_balance: number
  institution_name: string
  plaid_account_id?: string | null
  encrypted_plaid_access_token?: string | null
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
  frequency: BillFrequency
  category: string
  is_paid: boolean
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
