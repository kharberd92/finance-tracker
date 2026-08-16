'use client'

import { netWorthRuns, type NetWorthPoint } from '@/lib/finance/net-worth-history'
import {
  VB_W, VB_H, PAD, PLOT_TOP, PLOT_H, LABEL_Y, GRID_FRACTIONS, usd,
} from '@/components/dashboard/chart-geometry'

export function NetWorthSvg({ points }: { points: NetWorthPoint[] }) {
  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No net worth history yet.</p>
  }

  const values = points.map((p) => p.net_worth)
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const range = max - min || 1
  const y = (v: number) => PLOT_TOP + ((max - v) / range) * PLOT_H
  const slotW = (VB_W - PAD * 2) / Math.max(points.length - 1, 1)
  const x = (i: number) => PAD + slotW * i
  const pt = (i: number) => `${x(i)},${y(points[i].net_worth)}`

  // Contiguous same-source runs, not a single split index — a reconstructed
  // date is not guaranteed to sort before every observed one (see
  // netWorthRuns' doc comment for the staggered-account scenario this
  // guards against).
  const runs = netWorthRuns(points)
  const hasReconstructed = points.some((p) => p.source === 'reconstructed')

  const latest = points[points.length - 1]
  // One string child only — interleaved expressions break hydration in Next 16.
  const caption = `Net worth ${usd(latest.net_worth)} as of ${latest.as_of}`

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Net worth over time"
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
        {runs.map((run, i) => (
          <polyline
            key={i}
            points={run.indices.map(pt).join(' ')}
            fill="none"
            strokeWidth={2}
            strokeDasharray={run.source === 'reconstructed' ? '5 4' : undefined}
            className={run.source === 'reconstructed' ? 'stroke-muted-foreground' : 'stroke-net'}
          />
        ))}
        <text x={PAD} y={LABEL_Y} className="fill-muted-foreground text-[11px]">
          {points[0].as_of}
        </text>
        <text x={VB_W - PAD} y={LABEL_Y} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {latest.as_of}
        </text>
      </svg>

      {hasReconstructed && (
        <p className="text-xs text-muted-foreground">
          <span className="mr-1 inline-block h-px w-4 border-t border-dashed border-muted-foreground align-middle" />
          Dashed points are estimated from transaction history, not recorded balances.
        </p>
      )}
    </div>
  )
}
