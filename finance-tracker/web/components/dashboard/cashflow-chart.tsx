'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cashflowDomain, type CashflowMonth } from '@/lib/finance/cashflow'

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// viewBox geometry — unitless; the <svg> scales to its container via w-full + viewBox.
const SLOT = 56
const BAR = 16
const GAP = 4
const PAD = 8
const PLOT_TOP = 8
const PLOT_H = 160
const LABEL_H = 22

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

  const totalW = PAD * 2 + data.length * SLOT
  const totalH = PLOT_TOP + PLOT_H + LABEL_H
  const netPoints = data
    .map((r, i) => `${PAD + i * SLOT + SLOT / 2},${y(r.net)}`)
    .join(' ')

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cashflow</h2>
        <div className="flex gap-1">
          <Button size="sm" variant={span === 6 ? 'secondary' : 'outline'} onClick={() => setSpan(6)}>
            6M
          </Button>
          <Button size="sm" variant={span === 12 ? 'secondary' : 'outline'} onClick={() => setSpan(12)}>
            12M
          </Button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Monthly income, expense, and net cashflow"
      >
        <line x1={PAD} y1={y0} x2={totalW - PAD} y2={y0} className="stroke-border" strokeWidth={1} />

        {data.map((r, i) => {
          const slotX = PAD + i * SLOT
          const incomeX = slotX + (SLOT - (2 * BAR + GAP)) / 2
          const expenseX = incomeX + BAR + GAP
          return (
            <g key={r.month}>
              <rect x={incomeX} y={y(r.income)} width={BAR} height={Math.max(0, y0 - y(r.income))} className="fill-green-600" />
              <rect x={expenseX} y={y(r.expense)} width={BAR} height={Math.max(0, y0 - y(r.expense))} className="fill-red-600" />
              <title>
                {monthLabel(r.month)}: income {usd(r.income)}, expense {usd(r.expense)}, net {usd(r.net)}
              </title>
              <text x={slotX + SLOT / 2} y={totalH - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {monthLabel(r.month)}
              </text>
            </g>
          )
        })}

        <g className="text-foreground">
          <polyline points={netPoints} fill="none" stroke="currentColor" strokeWidth={1.5} />
          {data.map((r, i) => (
            <circle key={r.month} cx={PAD + i * SLOT + SLOT / 2} cy={y(r.net)} r={2.5} fill="currentColor" />
          ))}
        </g>
      </svg>

      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-green-600" /> Income
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-600" /> Expense
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-3 bg-foreground" /> Net
        </span>
      </div>
    </Card>
  )
}
