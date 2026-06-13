import type { Goal } from '@/lib/types'

/** Progress as a 0..1 fraction, clamped. Returns 0 for a non-positive target. */
export function goalProgress(goal: Goal): number {
  if (goal.target_amount <= 0) return 0
  return Math.min(1, goal.current_amount / goal.target_amount)
}

/**
 * Whole months until the goal is met at a fixed monthly contribution.
 * 0 if already met; null if the contribution can never complete it.
 */
export function monthsToGoal(goal: Goal, monthlyContribution: number): number | null {
  if (goal.current_amount >= goal.target_amount) return 0
  if (monthlyContribution <= 0) return null
  return Math.ceil((goal.target_amount - goal.current_amount) / monthlyContribution)
}
