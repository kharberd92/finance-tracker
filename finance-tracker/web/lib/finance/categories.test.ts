import { describe, it, expect } from 'vitest'
import { CATEGORIES, mapPlaidCategory } from './categories'

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
