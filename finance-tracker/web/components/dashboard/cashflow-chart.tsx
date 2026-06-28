'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { cashflowDomain, type CashflowMonth } from '@/lib/finance/cashflow'

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Fixed viewBox — locks the chart's aspect ratio (~760×185, mockup v5) regardless
// of how many months are shown; bars are positioned by computed slot width.
const VB_W = 760
const VB_H = 185
const PAD = 20
const PLOT_TOP = 15
const PLOT_H = 125 // zero line lands at y=140 when the domain minimum is 0
const LABEL_Y = 166
const BAR_W = 22
const BAR_GAP = 6

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.slice(5)) - 1] ?? ym
}

export function CashflowChart({ rows }: { rows: CashflowMonth[] }) {
  const [span, setSpan] = useState<6 | 12>(6)
  const data = rows.slice(-span)

  const domainMax = cashflowDomain(data)
  const domainMin = Math.min(0, ...data.map((r) => r.net))
  const range = domainMax - domainMin || 1
  const y = (v: number) => PLOT_TOP + ((domainMax - v) / range) * PLOT_H
  const y0 = y(0)

  const slotW = (VB_W - PAD * 2) / data.length
  const cx = (i: number) => PAD + slotW * i + slotW / 2
  const netPoints = data.map((r, i) => `${cx(i)},${y(r.net)}`).join(' ')
  const gridFractions = [0.25, 0.5, 0.75, 1]

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cashflow</h2>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs">
          {([6, 12] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                span === s ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {s}M
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Monthly income, expense, and net cashflow"
      >
        {gridFractions.map((f) => {
          const gy = y0 - f * (y0 - PLOT_TOP)
          return <line key={f} x1={PAD} y1={gy} x2={VB_W - PAD} y2={gy} className="stroke-border/40" strokeWidth={1} />
        })}
        <line x1={PAD} y1={y0} x2={VB_W - PAD} y2={y0} className="stroke-border" strokeWidth={1} />

        {data.map((r, i) => {
          const incomeX = cx(i) - BAR_W - BAR_GAP / 2
          const expenseX = cx(i) + BAR_GAP / 2
          return (
            <g key={r.month}>
              <rect x={incomeX} y={y(r.income)} width={BAR_W} height={Math.max(0, y0 - y(r.income))} rx={3} className="fill-income" />
              <rect x={expenseX} y={y(r.expense)} width={BAR_W} height={Math.max(0, y0 - y(r.expense))} rx={3} className="fill-expense" />
              <title>{`${monthLabel(r.month)}: income ${usd(r.income)}, expense ${usd(r.expense)}, net ${usd(r.net)}`}</title>
              <text x={cx(i)} y={LABEL_Y} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {monthLabel(r.month)}
              </text>
            </g>
          )
        })}

        <g className="text-primary">
          <polyline points={netPoints} fill="none" stroke="currentColor" strokeWidth={2.5} />
          {data.map((r, i) => (
            <circle key={r.month} cx={cx(i)} cy={y(r.net)} r={3.5} fill="currentColor" />
          ))}
        </g>
      </svg>

      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-income" /> Income
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-expense" /> Expense
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-3 bg-primary" /> Net
        </span>
      </div>
    </Card>
  )
}
