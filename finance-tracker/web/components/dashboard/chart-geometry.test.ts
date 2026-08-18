import { describe, it, expect } from 'vitest'
import { dayLabel, monthLabel } from './chart-geometry'

describe('dayLabel', () => {
  it('reads as a date rather than an ISO string', () => {
    expect(dayLabel('2026-08-16')).toBe('Aug 16, 2026')
  })

  it('drops the leading zero from the day', () => {
    expect(dayLabel('2026-04-05')).toBe('Apr 5, 2026')
  })

  it('labels a month-end without rolling into the next day', () => {
    // Formatted from string parts: parsing this as a Date gives UTC midnight,
    // which any timezone behind UTC would render as the 30th.
    expect(dayLabel('2026-07-31')).toBe('Jul 31, 2026')
  })

  it('falls back to the raw value when the month is not real', () => {
    expect(dayLabel('2026-13-01')).toBe('2026-13-01')
    expect(dayLabel('nonsense')).toBe('nonsense')
  })
})

describe('monthLabel', () => {
  it('abbreviates the month', () => {
    expect(monthLabel('2026-01')).toBe('Jan')
    expect(monthLabel('2026-12')).toBe('Dec')
  })

  it('falls back to the raw value when the month is not real', () => {
    expect(monthLabel('2026-99')).toBe('2026-99')
  })
})
