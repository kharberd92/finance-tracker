# Dashboard + Cashflow Charts Implementation Plan (Plan 5e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder dashboard with a real landing page — current net worth, a this-month cashflow summary, a monthly income/expense/net chart with a 6/12-month toggle, and four live widgets (budgets, goals, bills, recent transactions).

**Architecture:** A Server Component (`app/(app)/page.tsx`) fetches accounts, a trailing-12-month transaction window, budgets, bills, and goals in one `Promise.all`, then composes server-rendered pieces (net worth card, cashflow summary, four widgets) plus one `"use client"` chart that owns the 6/12 toggle. All cashflow math lives in a new pure, unit-tested `lib/finance/cashflow.ts`; the chart is hand-rolled SVG (no charting library).

**Tech Stack:** Next.js 16 (App Router, Server Components) · React 19 · TypeScript · Tailwind CSS v4 · `@supabase/ssr` · Vitest.

**Design source:** `docs/superpowers/specs/2026-06-26-dashboard-cashflow-design.md`

## Global Constraints

- All commands run from `finance-tracker/web/`.
- Route paths contain parens (`app/(app)/page.tsx`) — quote them in the shell.
- Only `lib/finance/` is unit-tested (pure logic); no component/render tests.
- Income/expense **exclude** `category === 'Transfer'`; income = Σ positive amounts, expense = Σ |negative amounts|, net = income − expense.
- Net worth stays a single current figure — **no** net-worth trend line, **no** new DB tables/migrations.
- No new dependencies; no charting library. The chart is custom SVG.
- Reuse existing `Card`/`Button`/`EmptyState` + Tailwind; no new shadcn components.
- Next 16: this is not stock Next.js — consult `node_modules/next/dist/docs/` before using an unfamiliar API. `cookies()` is async; the root guard is `proxy.ts` (already in place — untouched here).

---

### Task 1: `lib/finance/cashflow.ts` pure helper

**Files:**
- Create: `finance-tracker/web/lib/finance/cashflow.ts`
- Test: `finance-tracker/web/lib/finance/cashflow.test.ts`

**Interfaces:**
- Consumes: `shiftMonth` from `@/lib/finance/month`; `Transaction` from `@/lib/types`.
- Produces:
  - `interface CashflowMonth { month: string; income: number; expense: number; net: number }`
  - `trailingMonths(current: string, count: number): string[]` — `count` `'YYYY-MM'` strings ending at `current`, oldest first.
  - `monthlyCashflow(transactions: Transaction[], months: string[]): CashflowMonth[]` — one row per month, zero-filled.
  - `cashflowDomain(rows: CashflowMonth[]): number` — max income/expense magnitude, min 1.

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/cashflow.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { trailingMonths, monthlyCashflow, cashflowDomain } from './cashflow'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -10,
    date: '2026-06-15', merchant_name: 'Shop', category: 'Groceries',
    notes: null, is_manual: false, plaid_transaction_id: null, ...partial,
  }
}

describe('trailingMonths', () => {
  it('returns count months ending at current, oldest first', () => {
    expect(trailingMonths('2026-06', 6)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    ])
  })

  it('rolls over year boundaries', () => {
    expect(trailingMonths('2026-02', 6)).toEqual([
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
  })
})

describe('monthlyCashflow', () => {
  it('sums positive amounts as income and negative as expense magnitude', () => {
    const txns = [
      txn({ amount: 2000, category: 'Income', date: '2026-06-01' }),
      txn({ amount: -500, category: 'Groceries', date: '2026-06-10' }),
      txn({ amount: -300, category: 'Shopping', date: '2026-06-20' }),
    ]
    expect(monthlyCashflow(txns, ['2026-06'])).toEqual([
      { month: '2026-06', income: 2000, expense: 800, net: 1200 },
    ])
  })

  it('excludes Transfer transactions from income and expense', () => {
    const txns = [
      txn({ amount: 1000, category: 'Transfer', date: '2026-06-05' }),
      txn({ amount: -1000, category: 'Transfer', date: '2026-06-06' }),
      txn({ amount: -100, category: 'Groceries', date: '2026-06-07' }),
    ]
    expect(monthlyCashflow(txns, ['2026-06'])).toEqual([
      { month: '2026-06', income: 0, expense: 100, net: -100 },
    ])
  })

  it('zero-fills months with no transactions', () => {
    expect(monthlyCashflow([], ['2026-05', '2026-06'])).toEqual([
      { month: '2026-05', income: 0, expense: 0, net: 0 },
      { month: '2026-06', income: 0, expense: 0, net: 0 },
    ])
  })

  it('buckets transactions into the right month (prefix match, not substring)', () => {
    const txns = [
      txn({ amount: -100, date: '2026-05-31' }),
      txn({ amount: -200, date: '2026-06-01' }),
    ]
    const rows = monthlyCashflow(txns, ['2026-05', '2026-06'])
    expect(rows[0].expense).toBe(100)
    expect(rows[1].expense).toBe(200)
  })
})

describe('cashflowDomain', () => {
  it('returns the largest income or expense magnitude', () => {
    const rows = [
      { month: '2026-05', income: 500, expense: 900, net: -400 },
      { month: '2026-06', income: 1200, expense: 300, net: 900 },
    ]
    expect(cashflowDomain(rows)).toBe(1200)
  })

  it('falls back to 1 when all values are zero', () => {
    expect(cashflowDomain([{ month: '2026-06', income: 0, expense: 0, net: 0 }])).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/cashflow.test.ts`
Expected: FAIL — `Failed to resolve import "./cashflow"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/finance/cashflow.ts`:

```ts
import type { Transaction } from '@/lib/types'
import { shiftMonth } from '@/lib/finance/month'

export interface CashflowMonth {
  month: string // 'YYYY-MM'
  income: number
  expense: number
  net: number
}

/** `count` 'YYYY-MM' strings ending at `current`, oldest first. */
export function trailingMonths(current: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(current, i - (count - 1)))
}

/**
 * One CashflowMonth per entry in `months` (zero-filled when empty).
 * Income = Σ positive amounts; expense = Σ |negative amounts|; both exclude
 * Transfer transactions. net = income − expense.
 */
export function monthlyCashflow(
  transactions: Transaction[],
  months: string[],
): CashflowMonth[] {
  return months.map((month) => {
    let income = 0
    let expense = 0
    for (const t of transactions) {
      if (t.category === 'Transfer') continue
      if (!t.date.startsWith(`${month}-`)) continue
      if (t.amount > 0) income += t.amount
      else if (t.amount < 0) expense += -t.amount
    }
    return { month, income, expense, net: income - expense }
  })
}

/** Largest income/expense magnitude across rows, for y-axis scaling (min 1). */
export function cashflowDomain(rows: CashflowMonth[]): number {
  const max = Math.max(0, ...rows.flatMap((r) => [r.income, r.expense]))
  return max > 0 ? max : 1
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/cashflow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/cashflow.ts finance-tracker/web/lib/finance/cashflow.test.ts
git commit -m "feat(web): add cashflow finance helper (monthly income/expense/net)"
```

---

### Task 2: Dashboard data fetch + net worth + this-month summary

Replaces the placeholder page with a server component that fetches the trailing
12-month transaction window and renders the net worth card plus a this-month
cashflow summary. The chart and widgets land in Tasks 3–4.

**Files:**
- Create: `finance-tracker/web/components/dashboard/cashflow-summary.tsx`
- Modify: `finance-tracker/web/app/(app)/page.tsx` (full rewrite of the placeholder)

**Interfaces:**
- Consumes: `netWorth` (`@/lib/finance/net-worth`); `trailingMonths`, `monthlyCashflow`, `CashflowMonth` (`@/lib/finance/cashflow`); `Account`, `Transaction` (`@/lib/types`); `Card` (`@/components/ui/card`).
- Produces: `CashflowSummary({ row }: { row: CashflowMonth })` — a server component card.

- [ ] **Step 1: Write the cashflow summary component**

Create `finance-tracker/web/components/dashboard/cashflow-summary.tsx`:

```tsx
import { Card } from '@/components/ui/card'
import type { CashflowMonth } from '@/lib/finance/cashflow'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function CashflowSummary({ row }: { row: CashflowMonth }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase text-muted-foreground">This month — {row.month}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-muted-foreground">Income</p>
          <p className="font-semibold text-green-600">{usd(row.income)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Expenses</p>
          <p className="font-semibold text-red-600">{usd(row.expense)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Net</p>
          <p className={`font-semibold ${row.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {usd(row.net)}
          </p>
        </div>
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Rewrite the dashboard page**

Replace the entire contents of `finance-tracker/web/app/(app)/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { trailingMonths, monthlyCashflow } from '@/lib/finance/cashflow'
import { Card } from '@/components/ui/card'
import { CashflowSummary } from '@/components/dashboard/cashflow-summary'
import type { Account, Transaction } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function DashboardPage() {
  const month = currentMonth()
  const months = trailingMonths(month, 12)
  const windowStart = `${months[0]}-01`

  const supabase = await createClient()
  const [accountsRes, txnsRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase
      .from('transactions')
      .select('*')
      .gte('date', windowStart)
      .order('date', { ascending: false }),
  ])
  const accounts = (accountsRes.data ?? []) as Account[]
  const transactions = (txnsRes.data ?? []) as Transaction[]

  const rows = monthlyCashflow(transactions, months)
  const total = netWorth(accounts)

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <p className="text-xs uppercase text-muted-foreground">Net worth</p>
        <p className="text-3xl font-bold">
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </Card>

      <CashflowSummary row={rows[rows.length - 1]} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck; build succeeds with `/` (Dashboard) in the route list.

- [ ] **Step 4: Commit**

```bash
git add "finance-tracker/web/app/(app)/page.tsx" finance-tracker/web/components/dashboard/cashflow-summary.tsx
git commit -m "feat(web): dashboard net worth + this-month cashflow summary"
```

---

### Task 3: Cashflow chart (custom SVG, 6/12 toggle)

**Files:**
- Create: `finance-tracker/web/components/dashboard/cashflow-chart.tsx`
- Modify: `finance-tracker/web/app/(app)/page.tsx` (render the chart)

**Interfaces:**
- Consumes: `cashflowDomain`, `CashflowMonth` (`@/lib/finance/cashflow`); `Card`, `Button`.
- Produces: `CashflowChart({ rows }: { rows: CashflowMonth[] })` — a `"use client"` component; `rows` is the full 12-month series (oldest→newest); it slices to 6 or 12 internally.

- [ ] **Step 1: Write the chart component**

Create `finance-tracker/web/components/dashboard/cashflow-chart.tsx`:

```tsx
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
```

- [ ] **Step 2: Render the chart on the dashboard**

In `finance-tracker/web/app/(app)/page.tsx`, add the import after the `CashflowSummary` import:

```tsx
import { CashflowChart } from '@/components/dashboard/cashflow-chart'
```

Then add the chart directly below `<CashflowSummary ... />` in the returned JSX:

```tsx
      <CashflowSummary row={rows[rows.length - 1]} />

      <CashflowChart rows={rows} />
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck; build succeeds.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`, open the dashboard. Expected: grouped green/red bars per month with a net line on top; the **6M/12M** toggle switches the month count instantly (no page reload / refetch); hovering a bar shows the income/expense/net tooltip. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/app/(app)/page.tsx" finance-tracker/web/components/dashboard/cashflow-chart.tsx
git commit -m "feat(web): add SVG cashflow chart with 6/12-month toggle"
```

---

### Task 4: Dashboard widgets + docs

Adds the four summary widgets, wires the remaining data fetches into the page,
and updates `CLAUDE.md`.

**Files:**
- Create: `finance-tracker/web/components/dashboard/budget-widget.tsx`
- Create: `finance-tracker/web/components/dashboard/goals-widget.tsx`
- Create: `finance-tracker/web/components/dashboard/bills-widget.tsx`
- Create: `finance-tracker/web/components/dashboard/recent-transactions-widget.tsx`
- Modify: `finance-tracker/web/app/(app)/page.tsx` (fetch budgets/bills/goals; render the grid)
- Modify: `CLAUDE.md` (Plan 5e status)

**Interfaces:**
- Consumes: `spentThisMonth`, `budgetStatus` (`@/lib/finance/budget`); `goalProgress` (`@/lib/finance/goal`); `nextDueDate`, `daysUntilDue`, `isPaid` (`@/lib/finance/bill`); `EmptyState`; `Card`; `Link` from `next/link`; `Budget`, `Goal`, `Bill`, `Transaction` (`@/lib/types`).
- Produces (all plain server components):
  - `BudgetWidget({ budgets, transactions, year, month }: { budgets: Budget[]; transactions: Transaction[]; year: number; month: number })`
  - `GoalsWidget({ goals }: { goals: Goal[] })`
  - `BillsWidget({ bills, now }: { bills: Bill[]; now: Date })`
  - `RecentTransactionsWidget({ transactions }: { transactions: Transaction[] })`

- [ ] **Step 1: Write the budget widget**

Create `finance-tracker/web/components/dashboard/budget-widget.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { spentThisMonth, budgetStatus } from '@/lib/finance/budget'
import type { Budget, Transaction } from '@/lib/types'

const STATUS_BAR = { under: 'bg-green-600', near: 'bg-amber-500', over: 'bg-red-600' } as const
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function BudgetWidget({
  budgets,
  transactions,
  year,
  month,
}: {
  budgets: Budget[]
  transactions: Transaction[]
  year: number
  month: number
}) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Spent vs. budget</p>
        <Link href="/budgets" className="text-sm text-muted-foreground hover:text-foreground">→</Link>
      </div>
      {budgets.length === 0 ? (
        <EmptyState title="No budgets yet" hint="Add a category budget to track spending." />
      ) : (
        <ul className="space-y-2">
          {budgets.slice(0, 5).map((b) => {
            const spent = spentThisMonth(transactions, b.category, year, month)
            const status = budgetStatus(spent, b.monthly_limit)
            const pct = b.monthly_limit > 0 ? Math.min(100, (spent / b.monthly_limit) * 100) : 100
            return (
              <li key={b.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{b.category}</span>
                  <span className="text-muted-foreground">{usd(spent)} / {usd(b.monthly_limit)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Write the goals widget**

Create `finance-tracker/web/components/dashboard/goals-widget.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { goalProgress } from '@/lib/finance/goal'
import type { Goal } from '@/lib/types'

export function GoalsWidget({ goals }: { goals: Goal[] }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Goals progress</p>
        <Link href="/goals" className="text-sm text-muted-foreground hover:text-foreground">→</Link>
      </div>
      {goals.length === 0 ? (
        <EmptyState title="No goals yet" hint="Create a savings goal to start tracking." />
      ) : (
        <ul className="space-y-2">
          {goals.slice(0, 5).map((g) => {
            const pct = goalProgress(g.current_amount, g.target_amount)
            return (
              <li key={g.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span>{g.icon} {g.name}</span>
                  <span className="text-muted-foreground">{Math.round(pct)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: g.color_hex }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Write the bills widget**

Create `finance-tracker/web/components/dashboard/bills-widget.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { nextDueDate, daysUntilDue, isPaid } from '@/lib/finance/bill'
import type { Bill } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

function dueLabel(days: number | null): string {
  if (days === null) return ''
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'due today'
  return `in ${days}d`
}

export function BillsWidget({ bills, now }: { bills: Bill[]; now: Date }) {
  const upcoming = bills
    .filter((b) => !isPaid(b, now))
    .map((b) => ({ bill: b, due: nextDueDate(b, now), days: daysUntilDue(b, now) }))
    .filter((x) => x.due !== null)
    .sort((a, b) => a.due!.getTime() - b.due!.getTime())
    .slice(0, 5)

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Upcoming bills</p>
        <Link href="/bills" className="text-sm text-muted-foreground hover:text-foreground">→</Link>
      </div>
      {upcoming.length === 0 ? (
        <EmptyState title="No upcoming bills" hint="Add recurring bills to see what's due." />
      ) : (
        <ul className="space-y-2">
          {upcoming.map(({ bill, days }) => (
            <li key={bill.id} className="flex justify-between text-sm">
              <span>{bill.name}</span>
              <span className="text-muted-foreground">{usd(bill.amount)} · {dueLabel(days)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
```

- [ ] **Step 4: Write the recent-transactions widget**

Create `finance-tracker/web/components/dashboard/recent-transactions-widget.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import type { Transaction } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function RecentTransactionsWidget({ transactions }: { transactions: Transaction[] }) {
  // The page already fetches transactions ordered by date descending.
  const recent = transactions.slice(0, 5)
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Recent transactions</p>
        <Link href="/transactions" className="text-sm text-muted-foreground hover:text-foreground">→</Link>
      </div>
      {recent.length === 0 ? (
        <EmptyState title="No transactions yet" hint="Connect a bank or add one manually." />
      ) : (
        <ul className="space-y-2">
          {recent.map((t) => (
            <li key={t.id} className="flex justify-between text-sm">
              <span className="truncate">{t.merchant_name}</span>
              <span className="flex shrink-0 gap-2">
                <span className={t.amount < 0 ? 'text-red-600' : 'text-green-600'}>{usd(t.amount)}</span>
                <span className="text-muted-foreground">{t.date.slice(5)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
```

- [ ] **Step 5: Wire the widgets into the dashboard page**

In `finance-tracker/web/app/(app)/page.tsx`, add these imports after the `CashflowChart` import:

```tsx
import { BudgetWidget } from '@/components/dashboard/budget-widget'
import { GoalsWidget } from '@/components/dashboard/goals-widget'
import { BillsWidget } from '@/components/dashboard/bills-widget'
import { RecentTransactionsWidget } from '@/components/dashboard/recent-transactions-widget'
import type { Account, Transaction, Budget, Bill, Goal } from '@/lib/types'
```

(Delete the old `import type { Account, Transaction } from '@/lib/types'` line — the new import above replaces it.)

Replace the `Promise.all` block and the lines that derive `accounts`/`transactions` with the five-query version, and add the `now`/`year`/`mon` locals:

```tsx
  const supabase = await createClient()
  const [accountsRes, txnsRes, budgetsRes, billsRes, goalsRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase
      .from('transactions')
      .select('*')
      .gte('date', windowStart)
      .order('date', { ascending: false }),
    supabase.from('budgets').select('*').order('category'),
    supabase.from('bills').select('*'),
    supabase.from('goals').select('*').order('name'),
  ])
  const accounts = (accountsRes.data ?? []) as Account[]
  const transactions = (txnsRes.data ?? []) as Transaction[]
  const budgets = (budgetsRes.data ?? []) as Budget[]
  const bills = (billsRes.data ?? []) as Bill[]
  const goals = (goalsRes.data ?? []) as Goal[]

  const rows = monthlyCashflow(transactions, months)
  const total = netWorth(accounts)
  const now = new Date()
  const [year, mon] = month.split('-').map(Number)
```

Add the widget grid directly below `<CashflowChart rows={rows} />` in the JSX:

```tsx
      <CashflowChart rows={rows} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={transactions} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
      </div>
```

- [ ] **Step 6: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean typecheck; build succeeds with `/` rendering the dashboard.

- [ ] **Step 7: Update CLAUDE.md**

In `C:\Users\kharb\CLAUDE.md`, under the `## Plans` list, update the Plan 5 line so 5e is no longer "Remaining". Change the end of the Plan 5 entry from:

```
5d Bills ... **complete** (...). Remaining: **5e Dashboard + cashflow charts**.
```

to:

```
5d Bills ... **complete** (...); **5e Dashboard + cashflow charts** (`2026-06-26-dashboard-cashflow.md`) **complete** (net worth + this-month cashflow summary, custom-SVG income/expense/net chart with 6/12-month toggle, live budget/goals/bills/recent-transactions widgets; pure logic in `lib/finance/cashflow.ts`). **Plan 5 complete.**
```

Also add a one-line entry to the Web App feature section describing the dashboard, after the Bills (Plan 5d) paragraph:

```
**Dashboard (Plan 5e):** the landing page (`app/(app)/page.tsx`) — net worth, a this-month income/expense/net summary, a custom-SVG cashflow chart (`components/dashboard/cashflow-chart.tsx`, 6/12-month toggle, no charting library), and four widgets (budgets/goals/bills/recent transactions) each linking to its page. Cashflow math is in `lib/finance/cashflow.ts` (`monthlyCashflow`/`trailingMonths`/`cashflowDomain`; income/expense exclude Transfer). Net worth stays a current figure — no historical snapshots/trend.
```

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: all suites green (including the new `cashflow.test.ts`).

- [ ] **Step 9: Manual smoke test**

Run `npm run dev` and open the dashboard. Verify:
- Net worth card and the this-month summary (Income/Expenses/Net) render; Net is green when positive, red when negative.
- The cashflow chart shows 6 months and toggles to 12 without a refetch.
- A `Transfer` transaction does **not** move the income/expense bars (add one via `/transactions` if needed and confirm the current-month summary is unchanged).
- Each widget shows real data (or its empty state) and its **→** link navigates to `/budgets`, `/goals`, `/bills`, `/transactions`.
Stop the dev server when done.

- [ ] **Step 10: Commit**

```bash
git add "finance-tracker/web/app/(app)/page.tsx" finance-tracker/web/components/dashboard/ CLAUDE.md
git commit -m "feat(web): add dashboard widgets (budgets, goals, bills, recent txns)"
```

---

## Self-Review notes

- **Spec coverage:** cashflow helper + transfer exclusion + zero-fill + domain (Task 1); net worth + this-month summary (Task 2); SVG chart + 6/12 toggle + net line + `<title>` tooltips (Task 3); four widgets with per-widget empty states + `→` links + single trailing-window fetch + docs (Task 4). Net-worth-trend and charting-library are explicit non-goals — correctly absent.
- **Negative net:** the chart computes `domainMin = Math.min(0, ...nets)` so the net line dips below the zero baseline correctly; bars use `Math.max(0, …)` heights so a zero value renders no bar.
- **Naming consistency:** `CashflowMonth`/`trailingMonths`/`monthlyCashflow`/`cashflowDomain` are used identically across Tasks 1–4; `CashflowSummary` takes `row`, `CashflowChart` takes `rows` (12-month series).
