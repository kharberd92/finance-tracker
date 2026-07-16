/** Canonical category vocabulary shared by the UI dropdowns and the Plaid mapper. */
export const CATEGORIES = [
  'Income',
  'Groceries',
  'Food And Drink',
  'Transportation',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Transfer',
  'Uncategorized',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Sentinel stored in transactions.category when a transaction is split across parts. Never a pickable category. */
export const SPLIT_CATEGORY = 'Split'

/** Maps Plaid's personal_finance_category.primary onto our list. */
const PLAID_PRIMARY_TO_CATEGORY: Record<string, Category> = {
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Bills & Utilities',
  BANK_FEES: 'Bills & Utilities',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food And Drink',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Shopping',
  GENERAL_SERVICES: 'Shopping',
  GOVERNMENT_AND_NON_PROFIT: 'Bills & Utilities',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Health',
  RENT_AND_UTILITIES: 'Bills & Utilities',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
}

export function mapPlaidCategory(plaidPrimary: string | null | undefined): Category {
  if (!plaidPrimary) return 'Uncategorized'
  return PLAID_PRIMARY_TO_CATEGORY[plaidPrimary] ?? 'Uncategorized'
}

/** Type guard: is a string one of our categories? */
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

/** Categories you can budget — spending only (excludes Income and Transfer). */
export const SPENDING_CATEGORIES: readonly Category[] = CATEGORIES.filter(
  (c) => c !== 'Income' && c !== 'Transfer',
)

/** Type guard: is a string a budgetable spending category? */
export function isSpendingCategory(value: unknown): value is Category {
  return isCategory(value) && value !== 'Income' && value !== 'Transfer'
}
