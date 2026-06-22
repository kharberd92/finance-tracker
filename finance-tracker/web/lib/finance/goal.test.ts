import { describe, it, expect } from 'vitest'
import { goalProgress, goalReached, monthlyPaceNeeded } from './goal'

describe('goalProgress', () => {
  it('is 0 at the start', () => {
    expect(goalProgress(0, 3000)).toBe(0)
  })

  it('is the percent partway', () => {
    expect(goalProgress(1500, 3000)).toBe(50)
  })

  it('is 100 at the target and caps overshoot at 100', () => {
    expect(goalProgress(3000, 3000)).toBe(100)
    expect(goalProgress(4000, 3000)).toBe(100)
  })

  it('returns 0 for a non-positive target', () => {
    expect(goalProgress(100, 0)).toBe(0)
    expect(goalProgress(100, -5)).toBe(0)
  })
})

describe('goalReached', () => {
  it('is true at or above the target', () => {
    expect(goalReached(3000, 3000)).toBe(true)
    expect(goalReached(3500, 3000)).toBe(true)
  })

  it('is false below the target or with a non-positive target', () => {
    expect(goalReached(2999, 3000)).toBe(false)
    expect(goalReached(5, 0)).toBe(false)
  })
})

describe('monthlyPaceNeeded', () => {
  it('returns null when there is no target date', () => {
    expect(monthlyPaceNeeded(0, 3000, null, '2026-06-21')).toBeNull()
  })

  it('returns null when the goal is already reached', () => {
    expect(monthlyPaceNeeded(3000, 3000, '2026-12-01', '2026-06-21')).toBeNull()
  })

  it('divides the remaining amount by whole months remaining', () => {
    expect(monthlyPaceNeeded(0, 3000, '2026-12-01', '2026-06-21')).toBe(500)
    expect(monthlyPaceNeeded(1200, 3000, '2026-09-01', '2026-06-21')).toBe(600)
  })

  it('treats a past target date as due now (full remaining)', () => {
    expect(monthlyPaceNeeded(0, 3000, '2026-01-01', '2026-06-21')).toBe(3000)
  })
})
