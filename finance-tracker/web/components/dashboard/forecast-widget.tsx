import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { dayLabel } from '@/components/dashboard/chart-geometry'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/**
 * The projected low over the next 30 days, linking to the page that explains
 * it. One figure only — the page owns the detail; this exists so the forecast
 * is discoverable, because a page nothing links to does not get used.
 */
export function ForecastWidget({
  low,
  startingCash,
}: {
  low: { balance: number; date: string } | null
  startingCash: number
}) {
  const negative = low !== null && low.balance < 0

  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Next 30 days</p>
        <Link href="/forecast" className="text-xs font-medium text-primary hover:underline">
          Forecast →
        </Link>
      </div>

      {low ? (
        <>
          <p className={`text-2xl font-bold tabular-nums ${negative ? 'text-expense' : ''}`}>
            {usd(low.balance)}
          </p>
          <p className="text-sm text-muted-foreground">
            {`Projected low on ${dayLabel(low.date)}, from ${usd(startingCash)} in cash today.`}
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold tabular-nums">{usd(startingCash)}</p>
          <p className="text-sm text-muted-foreground">
            Nothing is due in the next 30 days that the app knows about.
          </p>
        </>
      )}
    </Card>
  )
}
