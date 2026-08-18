'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { CashflowSvg } from '@/components/dashboard/cashflow-svg'
import { NetWorthSvg } from '@/components/dashboard/net-worth-svg'
import type { CashflowMonth } from '@/lib/finance/cashflow'
import {
  sliceTrailingMonths,
  type NetWorthPoint,
  type HiddenHistory,
} from '@/lib/finance/net-worth-history'

const SPANS = [6, 12] as const
type View = 'cashflow' | 'networth'

export function TrendPanel({
  cashflow,
  netWorth,
  hidden,
}: {
  cashflow: CashflowMonth[]
  netWorth: NetWorthPoint[]
  hidden?: HiddenHistory | null
}) {
  const [span, setSpan] = useState<6 | 12>(6)
  const [view, setView] = useState<View>('cashflow')
  const hasHistory = netWorth.length > 0
  const showingCashflow = view === 'cashflow' || !hasHistory

  // Sliced by date, not by count: observed points are daily and reconstructed
  // ones are month-end, so any points-per-month heuristic would show a span
  // unrelated to the button that was pressed.
  const shownNetWorth = sliceTrailingMonths(netWorth, span)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        {hasHistory ? (
          <div className="flex rounded-lg bg-muted p-0.5 text-xs">
            {(['cashflow', 'networth'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  view === v ? 'bg-accent-soft text-accent-soft-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {v === 'cashflow' ? 'Cashflow' : 'Net worth'}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="font-medium">Cashflow</h2>
        )}

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

      {showingCashflow ? (
        <CashflowSvg rows={cashflow.slice(-span)} />
      ) : (
        <NetWorthSvg points={shownNetWorth} />
      )}

      {!showingCashflow && hidden && (
        <p className="text-center text-xs text-muted-foreground">
          {`${hidden.dates} earlier ${hidden.dates === 1 ? 'date' : 'dates'} (${hidden.from} – ${hidden.to}) `}
          aren&rsquo;t charted &mdash; they cover only some accounts, so their totals are not
          comparable. Estimated history cannot include accounts with no transactions, such as
          investments and loans.
        </p>
      )}
      {showingCashflow && (
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
      )}
    </Card>
  )
}
