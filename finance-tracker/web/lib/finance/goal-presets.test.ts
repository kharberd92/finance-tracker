import { describe, it, expect } from 'vitest'
import { GOAL_ICONS, GOAL_COLORS, isGoalIcon, isGoalColor } from './goal-presets'

describe('goal presets', () => {
  it('has 8 icons and 6 colors', () => {
    expect(GOAL_ICONS).toHaveLength(8)
    expect(GOAL_COLORS).toHaveLength(6)
  })

  it('isGoalIcon accepts members and rejects non-members', () => {
    expect(isGoalIcon(GOAL_ICONS[0])).toBe(true)
    expect(isGoalIcon('🦄')).toBe(false)
    expect(isGoalIcon(123)).toBe(false)
  })

  it('isGoalColor accepts members and rejects non-members', () => {
    expect(isGoalColor(GOAL_COLORS[0])).toBe(true)
    expect(isGoalColor('#000000')).toBe(false)
    expect(isGoalColor(null)).toBe(false)
  })
})
