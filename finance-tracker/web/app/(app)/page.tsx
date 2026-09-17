import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { trailingMonths, monthlyCashflow } from '@/lib/finance/cashflow'
import { netWorthSeries, netWorthDelta, hiddenHistory } from '@/lib/finance/net-worth-history'
import { Card } from '@/components/ui/card'
import { CashflowSummary } from '@/components/dashboard/cashflow-summary'
import { TrendPanel } from '@/components/dashboard/trend-panel'
import { BudgetWidget } from '@/components/dashboard/budget-widget'
import { GoalsWidget } from '@/components/dashboard/goals-widget'
import { BillsWidget } from '@/components/dashboard/bills-widget'
import { RecentTransactionsWidget } from '@/components/dashboard/recent-transactions-widget'
import { FixedVariableCard } from '@/components/dashboard/fixed-variable-card'
import { ForecastWidget } from '@/components/dashboard/forecast-widget'
import { NetWorthSparkline } from '@/components/dashboard/net-worth-sparkline'
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import { explodeSplits } from '@/lib/finance/split'
import { detectRecurring, matchCandidates } from '@/lib/finance/recurring'
import {
  spendableCash,
  detectIncomeStreams,
  projectEvents,
  runningBalance,
  forecastLow,
} from '@/lib/finance/forecast'
import type {
  Account, Transaction, Budget, Bill, Goal, AccountBalanceSnapshot, RecurringDismissal,
} from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default async function DashboardPage() {
  const month = currentMonth()
  const months = trailingMonths(month, 12)
  // 13 months, not 12. Three consumers need the wider span: the recurring and
  // income detectors both window at 13 months, and the backfill writes
  // month-end snapshots across the same range (scripts/backfill-net-worth.ts),
  // so the oldest reconstructed point predates a 12-month window. The cashflow
  // chart is unaffected — monthlyCashflow filters to the twelve months it is
  // handed. Costs one extra month of rows and buys a forecast stat that cannot
  // disagree with /forecast.
  const windowStart = `${trailingMonths(month, 13)[0]}-01`

  const supabase = await createClient()
  const [accountsRes, txnsRes, budgetsRes, billsRes, goalsRes, dismissalsRes, snapshotsRes] =
    await Promise.all([
    supabase.from('accounts').select('*'),
    supabase
      .from('transactions')
      .select('*')
      .gte('date', windowStart)
      .order('date', { ascending: false }),
    supabase.from('budgets').select('*').order('category'),
    supabase.from('bills').select('*'),
    supabase.from('goals').select('*').order('name'),
    supabase.from('recurring_dismissals').select('*'),
    supabase
      .from('account_balance_snapshots')
      .select('*')
      .gte('as_of', windowStart)
      .order('as_of', { ascending: true }),
  ])
  const accounts = (accountsRes.data ?? []) as Account[]
  const transactions = (txnsRes.data ?? []) as Transaction[]
  const budgets = (budgetsRes.data ?? []) as Budget[]
  const bills = (billsRes.data ?? []) as Bill[]
  const goals = (goalsRes.data ?? []) as Goal[]
  const dismissals = (dismissalsRes.data ?? []) as RecurringDismissal[]

  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))
  const exploded = explodeSplits(transactions, splits)

  const rows = monthlyCashflow(exploded, months)
  const total = netWorth(accounts)
  const now = new Date()
  const [year, mon] = month.split('-').map(Number)

  // Same inputs and same rules as /forecast, so the two figures agree: `open`
  // candidates only (a promoted one already counts as its bill, a dismissed
  // one not at all), and the 30-day horizon the page opens on.
  const { open: openCandidates } = matchCandidates(
    detectRecurring(transactions, now),
    bills,
    dismissals.map((d) => d.merchant_name),
  )
  const forecastEvents = projectEvents(
    { bills, candidates: openCandidates, incomeStreams: detectIncomeStreams(transactions, now) },
    30,
    now,
  )
  const startingCash = spendableCash(accounts)
  const projectedLow = forecastLow(runningBalance(startingCash, forecastEvents))

  const snapshots = (snapshotsRes.data ?? []) as AccountBalanceSnapshot[]
  const nwSeries = netWorthSeries(snapshots, accounts)
  const delta = netWorthDelta(nwSeries, 30)
  // Dates missing an account are not comparable to dates that have it — plotting
  // them would spike the line by a newly linked account's whole balance. Charts
  // show the complete dates only; netWorthDelta applies the same rule itself.
  const nwPlot = nwSeries.filter((p) => p.complete)
  // Dropping them silently makes a completed backfill look like it did nothing,
  // so the chart says what was withheld and why.
  const nwHidden = hiddenHistory(nwSeries)
  const firstObserved = nwPlot.find((p) => p.source === 'observed')?.as_of

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.3fr_2fr]">
        <Card className="p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Net worth</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
          {delta ? (
            <span
              className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                delta.change >= 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense'
              }`}
            >
              {delta.change >= 0
                ? `▲ past ${delta.days} days +${usd(delta.change)}`
                : `▼ past ${delta.days} days ${usd(Math.abs(delta.change))}`}
            </span>
          ) : firstObserved ? (
            <span className="mt-2 inline-block text-xs text-muted-foreground">
              {`collecting since ${firstObserved}`}
            </span>
          ) : null}

          <NetWorthSparkline points={nwPlot} />
        </Card>

        <CashflowSummary row={rows[rows.length - 1]} />
      </div>

      <TrendPanel cashflow={rows} netWorth={nwPlot} hidden={nwHidden} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={exploded} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
        <ForecastWidget low={projectedLow} startingCash={startingCash} />
        <FixedVariableCard
          bills={bills}
          transactions={exploded}
          month={month}
          income={rows[rows.length - 1]?.income ?? 0}
        />
      </div>
    </div>
  )
}
