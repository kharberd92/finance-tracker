/** Progress toward a goal as a percent 0–100 (overshoot caps at 100). */
export function goalProgress(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, (current / target) * 100)
}

/** True once the goal is funded (target must be positive). */
export function goalReached(current: number, target: number): boolean {
  return target > 0 && current >= target
}

/** Whole calendar months from `today` to `targetDate` (both 'YYYY-MM-DD'), min 1. */
function monthsUntil(today: string, targetDate: string): number {
  const [ty, tm] = today.split('-').map(Number)
  const [gy, gm] = targetDate.split('-').map(Number)
  const diff = (gy * 12 + (gm - 1)) - (ty * 12 + (tm - 1))
  return Math.max(1, diff)
}

/**
 * Amount to save per month to reach the target by `targetDate`.
 * Returns null when there is no date or the goal is already reached.
 * A past date is treated as "due now" (1 month), yielding the full remaining amount.
 */
export function monthlyPaceNeeded(
  current: number,
  target: number,
  targetDate: string | null,
  today: string,
): number | null {
  if (!targetDate) return null
  if (goalReached(current, target)) return null
  const remaining = target - current
  return remaining / monthsUntil(today, targetDate)
}
