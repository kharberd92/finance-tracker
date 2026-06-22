/** Preset icons a goal can use (controlled list, validated server-side). */
export const GOAL_ICONS = ['🏖️', '🚗', '🏠', '🛟', '🎓', '🎁', '💍', '💰'] as const
export type GoalIcon = (typeof GOAL_ICONS)[number]

/** Preset progress-bar colors (hex), validated server-side. */
export const GOAL_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#d97706', '#e11d48', '#475569'] as const
export type GoalColor = (typeof GOAL_COLORS)[number]

/** Type guard: is a value one of the preset icons? */
export function isGoalIcon(value: unknown): value is GoalIcon {
  return typeof value === 'string' && (GOAL_ICONS as readonly string[]).includes(value)
}

/** Type guard: is a value one of the preset colors? */
export function isGoalColor(value: unknown): value is GoalColor {
  return typeof value === 'string' && (GOAL_COLORS as readonly string[]).includes(value)
}
