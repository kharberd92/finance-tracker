import type { ForecastEvent } from '@/lib/finance/forecast'
import { dayLabel } from '@/components/dashboard/chart-geometry'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const SOURCE: Record<ForecastEvent['kind'], string> = {
  bill: 'Tracked bill',
  recurring: 'Detected recurring',
  income: 'Detected income',
}

/**
 * Every projected movement, so the headline can be taken apart.
 *
 * A forecast the user cannot audit is a number they have no reason to
 * believe — and when it is wrong, this list is how they find the bill with
 * the stale due date or the charge they cancelled.
 */
export function EventList({ events }: { events: ForecastEvent[] }) {
  if (events.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1 pr-4 font-medium">Date</th>
            <th className="py-1 pr-4 font-medium">What</th>
            <th className="py-1 pr-4 font-medium">Source</th>
            <th className="py-1 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={`${e.date}-${e.label}-${i}`} className="border-t">
              <td className="py-1.5 pr-4 whitespace-nowrap">{dayLabel(e.date)}</td>
              <td className="py-1.5 pr-4">{e.label}</td>
              <td className="py-1.5 pr-4 text-muted-foreground">{SOURCE[e.kind]}</td>
              <td
                className={`py-1.5 text-right tabular-nums ${
                  e.amount >= 0 ? 'text-income' : 'text-expense'
                }`}
              >
                {e.amount >= 0 ? `+${usd(e.amount)}` : `-${usd(Math.abs(e.amount))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
