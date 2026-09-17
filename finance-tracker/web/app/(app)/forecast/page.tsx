import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/empty-state'
import { ForecastView } from '@/components/forecast/forecast-view'
import { detectRecurring, matchCandidates } from '@/lib/finance/recurring'
import { spendableCash, detectIncomeStreams } from '@/lib/finance/forecast'
import type { Account, Bill, RecurringDismissal, Transaction } from '@/lib/types'

export default async function ForecastPage() {
  const today = new Date()
  const windowStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 13, today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)

  const supabase = await createClient()
  const [accountsRes, billsRes, txnsRes, dismissalsRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase.from('bills').select('*').order('name'),
    supabase.from('transactions').select('*').gte('date', windowStart),
    supabase.from('recurring_dismissals').select('*'),
  ])

  const accounts = (accountsRes.data ?? []) as Account[]
  const bills = (billsRes.data ?? []) as Bill[]
  const transactions = (txnsRes.data ?? []) as Transaction[]
  const dismissals = (dismissalsRes.data ?? []) as RecurringDismissal[]

  // Raw parent rows: detection is merchant-level, so splits are irrelevant.
  const candidates = detectRecurring(transactions, today)
  // `open` only — a promoted candidate is already counted as its bill, and a
  // dismissed one the user has said is not recurring. Either would double-count.
  const { open } = matchCandidates(
    candidates,
    bills,
    dismissals.map((d) => d.merchant_name),
  )
  const incomeStreams = detectIncomeStreams(transactions, today)

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Forecast</h1>
        <p className="text-sm text-muted-foreground">
          What&rsquo;s already committed against the cash you have. Tracked bills use their real
          due dates; recurring charges and paychecks are projected from how regularly they have
          landed. Card spending only appears here once its payment is a tracked bill or a
          detected recurring charge.
        </p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          hint="Link or add an account before forecasting its cash."
        />
      ) : (
        <ForecastView
          startingCash={spendableCash(accounts)}
          today={today.toISOString().slice(0, 10)}
          inputs={{ bills, candidates: open, incomeStreams }}
        />
      )}
    </section>
  )
}
