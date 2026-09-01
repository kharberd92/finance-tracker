import { Card } from '@/components/ui/card'
import { dayLabel } from '@/components/dashboard/chart-geometry'
import type { DateCoverage } from '@/lib/finance/net-worth-history'

/**
 * What each month-end is still missing.
 *
 * The completeness guard is all-or-nothing per date: a date covering eleven of
 * twelve accounts charts exactly as well as one covering none. Without this
 * table, entering balances feels like shouting into a well — the user cannot
 * tell whether one more number finishes a date or nine more do.
 */
export function CoverageSummary({
  coverage,
  accountNames,
}: {
  coverage: DateCoverage[]
  accountNames: Map<string, string>
}) {
  const complete = coverage.filter((c) => c.covered === c.total).length

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h2 className="font-medium">Coverage</h2>
        <p className="text-sm text-muted-foreground">
          {`${complete} of ${coverage.length} month-ends have every account. `}
          Only those are charted &mdash; a date missing an account cannot be compared to one that
          has it.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Month-end</th>
              <th className="py-1 pr-4 font-medium">Accounts</th>
              <th className="py-1 font-medium">Missing</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => {
              const done = c.covered === c.total
              return (
                <tr key={c.as_of} className="border-t">
                  <td className="py-1.5 pr-4 whitespace-nowrap">{dayLabel(c.as_of)}</td>
                  <td className="py-1.5 pr-4 tabular-nums">
                    <span className={done ? 'text-income' : 'text-muted-foreground'}>
                      {c.covered} / {c.total}
                    </span>
                  </td>
                  <td className="py-1.5 text-muted-foreground">
                    {done
                      ? '—'
                      : c.missingAccountIds
                          .map((id) => accountNames.get(id) ?? id)
                          .join(', ')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
