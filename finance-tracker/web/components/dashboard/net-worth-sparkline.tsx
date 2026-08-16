import type { NetWorthPoint } from '@/lib/finance/net-worth-history'

const W = 120
const H = 28

/** Tiny inline trend line for the Net worth card. Renders nothing below 2 points. */
export function NetWorthSparkline({ points }: { points: NetWorthPoint[] }) {
  if (points.length < 2) return null

  const values = points.map((p) => p.net_worth)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = W / (points.length - 1)
  const path = points
    .map((p, i) => `${i * step},${H - ((p.net_worth - min) / range) * H}`)
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={path} fill="none" strokeWidth={1.5} className="stroke-net" />
    </svg>
  )
}
