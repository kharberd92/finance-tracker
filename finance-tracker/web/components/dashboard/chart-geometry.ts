/**
 * Shared coordinate system for the dashboard trend charts. The cashflow and
 * net worth SVGs render into the same panel slot, so they must agree on the
 * viewBox and plot band exactly — these values are defined once, here.
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
