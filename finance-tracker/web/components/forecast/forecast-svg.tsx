'use client'

import { forecastLow, type ForecastPoint } from '@/lib/finance/forecast'
import {
  VB_W, VB_H, PAD, PLOT_TOP, PLOT_H, LABEL_Y, GRID_FRACTIONS, usd, dayLabel,
} from '@/components/dashboard/chart-geometry'

/**
 * The projected cash curve.
 *
 * `origin` is today's measured balance and is the ONLY measured point on this
 * chart; everything after it is projection, so the whole line renders in the
 * dashed treatment `NetWorthSvg` established for reconstructed runs rather
 * than inventing a second vocabulary for "not measured".
 */
export function ForecastSvg({
  origin,
  points,
}: {
  origin: ForecastPoint
  points: ForecastPoint[]
}) {
  // Nothing projected: no bills due, no detected streams, or a horizon that
  // clears them all. Bare axes would read as a broken chart, so say what is
  // actually true — the same lesson NetWorthSvg learned.
  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
        <p className="text-sm font-medium text-muted-foreground">Nothing projected in this window</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          No tracked bill falls due and no recurring charge or paycheck is expected. Track a bill
          or let a few more months of transactions build up, and the curve appears.
        </p>
      </div>
    )
  }

  const all = [origin, ...points]
  const values = all.map((p) => p.balance)
  const max = Math.max(...values)
  // Anchor the floor at zero when the curve stays positive, so "how close to
  // empty" is readable off the axis rather than rescaled away.
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const y = (v: number) => PLOT_TOP + ((max - v) / range) * PLOT_H

  // Positioned by date: events cluster (three bills on the 1st, nothing for
  // two weeks), and even spacing would misdraw the shape of the month.
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const t0 = ms(all[0].date)
  const spanMs = ms(all[all.length - 1].date) - t0
  const x = (i: number) =>
    spanMs === 0 ? PAD : PAD + ((ms(all[i].date) - t0) / spanMs) * (VB_W - PAD * 2)

  const path = all.map((p, i) => `${x(i)},${y(p.balance)}`).join(' ')
  const zeroY = y(0)
  const showZero = min < 0

  // Via forecastLow, not a second reduce here: the headline and the chart
  // caption must never be able to disagree about where the low is.
  const low = forecastLow(points)!
  // One string child only — interleaved expressions break hydration in Next 16.
  const caption = `Projected cash, low of ${usd(low.balance)} on ${dayLabel(low.date)}`

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Projected cash balance over time"
      >
        <title>{caption}</title>
        {GRID_FRACTIONS.map((f) => (
          <line
            key={f}
            x1={PAD}
            x2={VB_W - PAD}
            y1={PLOT_TOP + f * PLOT_H}
            y2={PLOT_TOP + f * PLOT_H}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}

        {showZero && (
          <line
            x1={PAD}
            x2={VB_W - PAD}
            y1={zeroY}
            y2={zeroY}
            className="stroke-expense"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
        )}

        <polyline
          points={path}
          fill="none"
          strokeWidth={2}
          strokeDasharray="5 4"
          className="stroke-muted-foreground"
        />

        {/* Today's balance is measured; mark it so the one real point reads
            differently from the projection leaving it. */}
        <circle cx={x(0)} cy={y(origin.balance)} r={3.5} className="fill-net" />

        <text x={PAD} y={LABEL_Y} className="fill-muted-foreground text-[11px]">
          {dayLabel(all[0].date)}
        </text>
        <text x={VB_W - PAD} y={LABEL_Y} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {dayLabel(all[all.length - 1].date)}
        </text>
      </svg>

      <p className="text-center text-xs text-muted-foreground">
        Dashed because every point after today is a projection. Day-to-day variable spending is
        not included, so the real low is likely lower.
      </p>
    </div>
  )
}
