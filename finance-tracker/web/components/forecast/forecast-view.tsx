'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { ForecastSvg } from '@/components/forecast/forecast-svg'
import { EventList } from '@/components/forecast/event-list'
import { dayLabel } from '@/components/dashboard/chart-geometry'
import {
  projectEvents,
  runningBalance,
  forecastLow,
  type ForecastInputs,
} from '@/lib/finance/forecast'

const HORIZONS = [30, 60] as const

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function ForecastView({
  startingCash,
  today,
  inputs,
}: {
  startingCash: number
  today: string // ISO 'YYYY-MM-DD' — resolved on the server so the projection is deterministic
  inputs: ForecastInputs
}) {
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30)

  const events = projectEvents(inputs, horizon, new Date(`${today}T00:00:00Z`))
  const points = runningBalance(startingCash, events)
  const low = forecastLow(points)
  const negative = low !== null && low.balance < 0

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Projected low
            </p>
            {low ? (
              <>
                <p
                  className={`mt-1 text-3xl font-bold tabular-nums ${
                    negative ? 'text-expense' : ''
                  }`}
                >
                  {usd(low.balance)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{`on ${dayLabel(low.date)}`}</p>
              </>
            ) : (
              <p className="mt-1 text-3xl font-bold tabular-nums">{usd(startingCash)}</p>
            )}
          </div>

          <div className="flex shrink-0 rounded-lg bg-muted p-0.5 text-xs">
            {HORIZONS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  horizon === h
                    ? 'bg-accent-soft text-accent-soft-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                {h}D
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {negative
            ? `Cash is projected to go negative before ${dayLabel(low.date)}. Starting from ${usd(startingCash)} in checking and savings.`
            : `Starting from ${usd(startingCash)} in checking and savings.`}
        </p>
      </Card>

      <Card className="p-4">
        <ForecastSvg origin={{ date: today, balance: startingCash }} points={points} />
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-medium">What&rsquo;s expected</h2>
          <p className="text-sm text-muted-foreground">
            {events.length === 0
              ? 'Nothing is projected in this window.'
              : `${events.length} movements over the next ${horizon} days.`}
          </p>
        </div>
        <EventList events={events} />
      </Card>
    </div>
  )
}
