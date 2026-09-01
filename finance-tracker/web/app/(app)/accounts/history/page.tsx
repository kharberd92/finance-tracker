import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/empty-state'
import { CoverageSummary } from '@/components/accounts/coverage-summary'
import { BalanceHistoryView } from '@/components/accounts/balance-history-view'
import {
  historyMonthEnds,
  coverageByDate,
  HISTORY_MONTHS,
} from '@/lib/finance/net-worth-history'
import type { Account, AccountBalanceSnapshot } from '@/lib/types'

export default async function BalanceHistoryPage() {
  const today = new Date().toISOString().slice(0, 10)
  const dates = historyMonthEnds(HISTORY_MONTHS, today)

  const supabase = await createClient()
  const [accountsRes, snapshotsRes] = await Promise.all([
    supabase.from('accounts').select('*').order('name'),
    supabase
      .from('account_balance_snapshots')
      .select('*')
      .gte('as_of', dates[0])
      .order('as_of', { ascending: true }),
  ])

  const accounts = (accountsRes.data ?? []) as Account[]
  const snapshots = (snapshotsRes.data ?? []) as AccountBalanceSnapshot[]
  const coverage = coverageByDate(snapshots, accounts, dates)
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]))

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Balance history</h1>
          <p className="text-sm text-muted-foreground">
            Net worth history is estimated from transactions, so accounts without any &mdash;
            investments, loans, secondary accounts &mdash; have no past to estimate from. Fill
            those months in from your statements and they start charting.
          </p>
        </div>
        <Link href="/accounts" className="shrink-0 text-sm text-primary underline-offset-4 hover:underline">
          ← Accounts
        </Link>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          hint="Link or add an account before recording its balance history."
        />
      ) : (
        <>
          <CoverageSummary coverage={coverage} accountNames={accountNames} />
          <BalanceHistoryView accounts={accounts} snapshots={snapshots} dates={dates} />
        </>
      )}
    </section>
  )
}
