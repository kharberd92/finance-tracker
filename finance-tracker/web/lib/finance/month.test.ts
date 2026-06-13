import { describe, it, expect } from 'vitest'
import { monthBounds, shiftMonth } from './month'

describe('monthBounds', () => {
  it('returns the first day of the month and of the next month', () => {
    expect(monthBounds('2026-06')).toEqual({ start: '2026-06-01', end: '2026-07-01' })
  })

  it('rolls the year over in December', () => {
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })
})

describe('shiftMonth', () => {
  it('moves forward and backward', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07')
    expect(shiftMonth('2026-06', -1)).toBe('2026-05')
  })

  it('crosses year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})
