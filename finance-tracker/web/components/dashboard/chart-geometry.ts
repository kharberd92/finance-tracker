/**
 * Shared coordinate system and axis vocabulary for the dashboard trend charts.
 * The cashflow and net worth SVGs render into the same panel slot, so they must
 * agree on the viewBox, plot band, and date wording exactly — all defined once,
 * here.
 */
export const VB_W = 760
export const VB_H = 185
export const PAD = 20
export const PLOT_TOP = 15
export const PLOT_H = 125 // zero line lands at y=140 when the domain minimum is 0
export const LABEL_Y = 166

/** Gridline positions as fractions of the plot band, top to bottom. */
export const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

export const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** 'YYYY-MM' as a bare month abbreviation, e.g. 'Aug'. */
export function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.slice(5)) - 1] ?? ym
}

/**
 * 'YYYY-MM-DD' as 'Aug 16, 2026'.
 *
 * Formatted from the string parts rather than a parsed Date: 'YYYY-MM-DD'
 * parses as UTC midnight, so any formatter running in a timezone behind UTC
 * would render the previous day. Falls back to the raw value if the month is
 * not a real one, matching monthLabel.
 */
export function dayLabel(as_of: string): string {
  const [y, m, d] = as_of.split('-')
  const month = MONTH_ABBR[Number(m) - 1]
  if (!month || !y || !d) return as_of
  return `${month} ${Number(d)}, ${y}`
}
