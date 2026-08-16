'use client'

import { cashflowDomain, type CashflowMonth } from '@/lib/finance/cashflow'
import {
  VB_W, VB_H, PAD, PLOT_TOP, PLOT_H, LABEL_Y, GRID_FRACTIONS, usd,
} from '@/components/dashboard/chart-geometry'

const BAR_W = 22
const BAR_GAP = 6
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.slice(5)) - 1] ?? ym
}

export function CashflowSvg({ rows }: { rows: CashflowMonth[] }) {
  const data = rows

  const domainMax = cashflowDomain(data)
  const domainMin = Math.min(0, ...data.map((r) => r.net))
  const range = domainMax - domainMin || 1
  const y = (v: number) => PLOT_TOP + ((domainMax - v) / range) * PLOT_H
  const y0 = y(0)

  const slotW = (VB_W - PAD * 2) / data.length
  const cx = (i: number) => PAD + slotW * i + slotW / 2
  const netPoints = data.map((r, i) => `${cx(i)},${y(r.net)}`).join(' ')
  // Gridlines span the full plot band (top→bottom), so the area below the
  // zero baseline stays gridded when net goes negative.
  const gridFractions = GRID_FRACTIONS

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      className="h-auto w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Monthly income, expense, and net cashflow"
    >
      {gridFractions.map((f) => {
        const gy = PLOT_TOP + f * PLOT_H
        return <line key={f} x1={PAD} y1={gy} x2={VB_W - PAD} y2={gy} className="stroke-border/40" strokeWidth={1} />
      })}
      <line x1={PAD} y1={y0} x2={VB_W - PAD} y2={y0} className="stroke-border" strokeWidth={1} />

      {data.map((r, i) => {
        const incomeX = cx(i) - BAR_W - BAR_GAP / 2
        const expenseX = cx(i) + BAR_GAP / 2
        return (
          <g key={r.month}>
            <title>{`${monthLabel(r.month)}: income ${usd(r.income)}, expense ${usd(r.expense)}, net ${usd(r.net)}`}</title>
            <rect x={incomeX} y={y(r.income)} width={BAR_W} height={Math.max(0, y0 - y(r.income))} rx={3} className="fill-income" />
            <rect x={expenseX} y={y(r.expense)} width={BAR_W} height={Math.max(0, y0 - y(r.expense))} rx={3} className="fill-expense" />
            <text x={cx(i)} y={LABEL_Y} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {monthLabel(r.month)}
            </text>
          </g>
        )
      })}

      <g className="text-net">
        <polyline points={netPoints} fill="none" stroke="currentColor" strokeWidth={2.5} />
        {data.map((r, i) => (
          <circle key={r.month} cx={cx(i)} cy={y(r.net)} r={3.5} fill="currentColor" />
        ))}
      </g>
    </svg>
  )
}
