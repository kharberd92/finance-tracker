'use client'

import type { NetWorthPoint } from '@/lib/finance/net-worth-history'
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

  // Split at the LAST reconstructed point; it is shared by both polylines so
  // the dashed and solid runs meet rather than leaving a gap.
  const lastRecon = points.reduce((acc, p, i) => (p.source === 'reconstructed' ? i : acc), -1)
  const pt = (p: NetWorthPoint, i: number) => `${x(i)},${y(p.net_worth)}`
  const reconPoints = lastRecon >= 0 ? points.slice(0, lastRecon + 1).map(pt).join(' ') : ''
  const obsPoints = points.slice(Math.max(lastRecon, 0)).map((p, i) => pt(p, i + Math.max(lastRecon, 0))).join(' ')

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
        {reconPoints && (
          <polyline
            points={reconPoints}
            fill="none"
            strokeDasharray="5 4"
            strokeWidth={2}
            className="stroke-muted-foreground"
          />
        )}
        <polyline points={obsPoints} fill="none" strokeWidth={2} className="stroke-net" />
        <text x={PAD} y={LABEL_Y} className="fill-muted-foreground text-[11px]">
          {points[0].as_of}
        </text>
        <text x={VB_W - PAD} y={LABEL_Y} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {latest.as_of}
        </text>
      </svg>

      {lastRecon >= 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="mr-1 inline-block h-px w-4 border-t border-dashed border-muted-foreground align-middle" />
          Dashed points are estimated from transaction history, not recorded balances.
        </p>
      )}
    </div>
  )
}
