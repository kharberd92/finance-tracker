'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { CashflowSvg } from '@/components/dashboard/cashflow-svg'
import type { CashflowMonth } from '@/lib/finance/cashflow'

const SPANS = [6, 12] as const

export function TrendPanel({ cashflow }: { cashflow: CashflowMonth[] }) {
  const [span, setSpan] = useState<6 | 12>(6)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cashflow</h2>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs">
          {SPANS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                span === s ? 'bg-accent-soft text-accent-soft-foreground shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {s}M
            </button>
          ))}
        </div>
      </div>

      <CashflowSvg rows={cashflow.slice(-span)} />

      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-income" /> Income
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-expense" /> Expense
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-3 bg-net" /> Net
        </span>
      </div>
    </Card>
  )
}
