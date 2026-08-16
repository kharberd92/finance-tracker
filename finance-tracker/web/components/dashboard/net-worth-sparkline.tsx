import { netWorthRuns, type NetWorthPoint } from '@/lib/finance/net-worth-history'

const W = 120
const H = 28

/**
 * Tiny inline trend line for the Net worth card. Renders nothing below 2 points.
 *
 * Reconstructed stretches are dashed and muted, exactly as the full chart draws
 * them. Without that, a card whose chip honestly reads "collecting since ..."
 * would sit above a confident solid line made entirely of estimates.
 */
export function NetWorthSparkline({ points }: { points: NetWorthPoint[] }) {
  if (points.length < 2) return null

  const values = points.map((p) => p.net_worth)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = W / (points.length - 1)
  const pt = (i: number) => `${i * step},${H - ((points[i].net_worth - min) / range) * H}`

  const runs = netWorthRuns(points)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      {runs.map((run, i) => (
        <polyline
          key={i}
          points={run.indices.map(pt).join(' ')}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray={run.source === 'reconstructed' ? '5 4' : undefined}
          className={run.source === 'reconstructed' ? 'stroke-muted-foreground' : 'stroke-net'}
        />
      ))}
    </svg>
  )
}
