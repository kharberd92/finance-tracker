import { describe, it, expect } from 'vitest'
import { CATEGORIES, mapPlaidCategory, SPENDING_CATEGORIES, isSpendingCategory } from './categories'

describe('CATEGORIES', () => {
  it('includes the core categories and Uncategorized', () => {
    expect(CATEGORIES).toContain('Income')
    expect(CATEGORIES).toContain('Groceries')
    expect(CATEGORIES).toContain('Uncategorized')
  })
})

describe('mapPlaidCategory', () => {
  it('maps known Plaid primaries onto our list', () => {
    expect(mapPlaidCategory('FOOD_AND_DRINK')).toBe('Food And Drink')
    expect(mapPlaidCategory('TRANSPORTATION')).toBe('Transportation')
    expect(mapPlaidCategory('TRAVEL')).toBe('Travel')
    expect(mapPlaidCategory('INCOME')).toBe('Income')
    expect(mapPlaidCategory('RENT_AND_UTILITIES')).toBe('Bills & Utilities')
  })

  it('falls back to Uncategorized for unknown/empty', () => {
    expect(mapPlaidCategory('SOMETHING_NEW')).toBe('Uncategorized')
    expect(mapPlaidCategory(null)).toBe('Uncategorized')
    expect(mapPlaidCategory(undefined)).toBe('Uncategorized')
  })

  it('always returns a member of CATEGORIES', () => {
    const inputs = ['FOOD_AND_DRINK', 'TRANSPORTATION', 'WHATEVER', '', null]
    for (const i of inputs) {
      expect(CATEGORIES).toContain(mapPlaidCategory(i))
    }
  })
})

describe('SPENDING_CATEGORIES', () => {
  it('excludes Income and Transfer', () => {
    expect(SPENDING_CATEGORIES).not.toContain('Income')
    expect(SPENDING_CATEGORIES).not.toContain('Transfer')
  })

  it('includes spending categories, including Uncategorized', () => {
    expect(SPENDING_CATEGORIES).toContain('Groceries')
    expect(SPENDING_CATEGORIES).toContain('Food And Drink')
    expect(SPENDING_CATEGORIES).toContain('Uncategorized')
  })
})

describe('isSpendingCategory', () => {
  it('is true for spending categories, false for Income/Transfer/unknown', () => {
    expect(isSpendingCategory('Groceries')).toBe(true)
    expect(isSpendingCategory('Uncategorized')).toBe(true)
    expect(isSpendingCategory('Income')).toBe(false)
    expect(isSpendingCategory('Transfer')).toBe(false)
    expect(isSpendingCategory('Not A Category')).toBe(false)
  })
})
