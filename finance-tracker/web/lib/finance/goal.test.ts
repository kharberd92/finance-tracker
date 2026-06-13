import { describe, it, expect } from 'vitest'
import { goalProgress, monthsToGoal } from './goal'
import type { Goal } from '@/lib/types'

function goal(partial: Partial<Goal>): Goal {
  return {
    id: 'g', user_id: 'u', name: 'Emergency Fund',
    target_amount: 1000, current_amount: 0,
    icon: 'piggy', color_hex: '#16a34a', ...partial,
  }
}

describe('goalProgress', () => {
  it('returns a 0..1 fraction', () => {
    expect(goalProgress(goal({ target_amount: 1000, current_amount: 250 }))).toBe(0.25)
  })

  it('clamps to 1 when over-funded', () => {
    expect(goalProgress(goal({ target_amount: 1000, current_amount: 1500 }))).toBe(1)
  })

  it('returns 0 when target is 0 (avoids divide-by-zero)', () => {
    expect(goalProgress(goal({ target_amount: 0, current_amount: 100 }))).toBe(0)
  })
})

describe('monthsToGoal', () => {
  it('returns months remaining, rounded up', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 250 }), 100)).toBe(8)
  })

  it('returns 0 when already met', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 1000 }), 100)).toBe(0)
  })

  it('returns null when contribution is 0 or negative (never completes)', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 0 }), 0)).toBeNull()
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 0 }), -50)).toBeNull()
  })
})
