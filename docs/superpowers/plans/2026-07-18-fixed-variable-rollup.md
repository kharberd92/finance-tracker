# Fixed-vs-Variable Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dashboard card contrasting committed recurring cost ("fixed", from bills, normalized to $/mo) with actual discretionary spending ("variable", from exploded transactions), plus a committed-share-of-income ratio.

**Architecture:** A new pure module `lib/finance/fixed-variable.ts` computes the three numbers (committed $/mo via existing `monthlyCost`, variable spend excluding `Transfer` + `Bills & Utilities`, ratio vs. income). A new server component `components/dashboard/fixed-variable-card.tsx` renders the approved figures-first layout as a fifth widget in the dashboard grid. Zero new queries — the dashboard page already fetches bills, a 12-month transaction window, splits, exploded rows, and monthly income.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS · Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-fixed-variable-rollup-design.md`

## Global Constraints

- **Next.js 16 conventions** — see `finance-tracker/web/AGENTS.md`; verify APIs against `node_modules/next/dist/docs/` before writing code.
- **`lib/finance/` stays Supabase/React-free** — pure, unit-tested logic only.
- **Variable spend excludes exactly two categories:** `'Transfer'` and `'Bills & Utilities'` (the spec's A2 model; not configurable).
- **Money math rounded to cents** (`Math.round(n * 100) / 100`), matching `splitTotal` in `lib/finance/split.ts`.
- **Ratio is a whole percent; `null` when `income <= 0`** — the UI hides the caption on `null`, never renders ∞% or NaN.
- **Callers pass exploded rows** to `variableSpend` (dashboard already computes `exploded` via `explodeSplits`), so a split's `Bills & Utilities` part is excluded while sibling parts count.
- **Commands** (run from `finance-tracker/web`): `npx vitest run <file>` for one test file; `npx vitest run` for the suite; `npm run build` for the production build/typecheck.
- Follow the existing dashboard widget idiom: server component, `Card` + `Link` header row, `usd` formatter with `maximumFractionDigits: 0`, `bg-muted` bar tracks (see `components/dashboard/budget-widget.tsx`).

---

### Task 1: Pure logic — `lib/finance/fixed-variable.ts`

**Files:**
- Create: `finance-tracker/web/lib/finance/fixed-variable.ts`
- Test: `finance-tracker/web/lib/finance/fixed-variable.test.ts`

**Interfaces:**
- Consumes: `monthlyCost(bill: Bill): number` from `@/lib/finance/bill`; `Bill`, `Transaction` from `@/lib/types`.
- Produces (Task 2 relies on these exact signatures):
  - `totalCommittedMonthly(bills: Bill[]): number`
  - `variableSpend(transactions: Transaction[], month: string): number` — `month` is `'YYYY-MM'`
  - `committedShareOfIncome(committed: number, income: number): number | null`

- [ ] **Step 1: Write the failing tests**

Create `finance-tracker/web/lib/finance/fixed-variable.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  totalCommittedMonthly,
  variableSpend,
  committedShareOfIncome,
} from './fixed-variable'
import type { Bill, Transaction } from '@/lib/types'

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
    due_month: null, last_paid_date: null, ...partial,
  }
}

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -10,
    date: '2026-07-10', merchant_name: 'Store', category: 'Shopping',
    notes: null, is_manual: false, ...partial,
  }
}

describe('totalCommittedMonthly', () => {
  it('returns 0 for no bills', () => {
    expect(totalCommittedMonthly([])).toBe(0)
  })

  it('sums monthlyCost across mixed frequencies', () => {
    const bills = [
      bill({ frequency: 'monthly', amount: 100 }),   // 100
      bill({ frequency: 'weekly', amount: 12 }),     // 12*52/12 = 52
      bill({ frequency: 'quarterly', amount: 300, due_month: 1 }), // 100
      bill({ frequency: 'yearly', amount: 1200, due_month: 6 }),   // 100
    ]
    expect(totalCommittedMonthly(bills)).toBe(352)
  })

  it('rounds the sum to cents', () => {
    // weekly 10 → 10*52/12 = 43.333…
    expect(totalCommittedMonthly([bill({ frequency: 'weekly', amount: 10 })])).toBe(43.33)
  })
})

describe('variableSpend', () => {
  it('sums expense magnitudes in the month', () => {
    const rows = [
      txn({ amount: -25.5, category: 'Groceries' }),
      txn({ amount: -10.25, category: 'Entertainment' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(35.75)
  })

  it('excludes Transfer and Bills & Utilities', () => {
    const rows = [
      txn({ amount: -500, category: 'Transfer' }),
      txn({ amount: -1200, category: 'Bills & Utilities' }),
      txn({ amount: -40, category: 'Groceries' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(40)
  })

  it('ignores income and other months', () => {
    const rows = [
      txn({ amount: 3000, category: 'Income' }),
      txn({ amount: -40, date: '2026-06-30' }),
      txn({ amount: -60, date: '2026-07-01' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(60)
  })

  it('counts split parts individually when fed exploded rows', () => {
    // A $100 parent split $70 Groceries / $30 Bills & Utilities arrives
    // as two exploded rows; only the Groceries part is variable.
    const rows = [
      txn({ id: 'p:s1', amount: -70, category: 'Groceries' }),
      txn({ id: 'p:s2', amount: -30, category: 'Bills & Utilities' }),
    ]
    expect(variableSpend(rows, '2026-07')).toBe(70)
  })

  it('returns 0 when there are no transactions', () => {
    expect(variableSpend([], '2026-07')).toBe(0)
  })
})

describe('committedShareOfIncome', () => {
  it('returns a whole percent', () => {
    expect(committedShareOfIncome(1850, 4500)).toBe(41)
  })

  it('rounds to the nearest whole percent', () => {
    expect(committedShareOfIncome(500, 1500)).toBe(33)
    expect(committedShareOfIncome(1000, 1500)).toBe(67)
  })

  it('returns null when income is zero or negative', () => {
    expect(committedShareOfIncome(1850, 0)).toBeNull()
    expect(committedShareOfIncome(1850, -5)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `finance-tracker/web`): `npx vitest run lib/finance/fixed-variable.test.ts`
Expected: FAIL — cannot resolve `./fixed-variable`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/finance/fixed-variable.ts`:

```ts
import type { Bill, Transaction } from '@/lib/types'
import { monthlyCost } from '@/lib/finance/bill'

/**
 * Categories excluded from variable spend: Transfer (not spending) and
 * Bills & Utilities (fixed costs flowing through as transactions —
 * counting them would double-count the bills-based committed figure).
 */
const FIXED_FLOW_CATEGORIES = ['Transfer', 'Bills & Utilities']

const toCents = (n: number) => Math.round(n * 100) / 100

/** Total committed recurring cost across bills, normalized to $/mo. */
export function totalCommittedMonthly(bills: Bill[]): number {
  return toCents(bills.reduce((sum, b) => sum + monthlyCost(b), 0))
}

/**
 * Actual discretionary spend for `month` ('YYYY-MM'): the sum of expense
 * magnitudes, excluding FIXED_FLOW_CATEGORIES. Callers pass exploded rows
 * so a split's parts are judged per-part.
 */
export function variableSpend(transactions: Transaction[], month: string): number {
  let sum = 0
  for (const t of transactions) {
    if (t.amount >= 0) continue
    if (!t.date.startsWith(`${month}-`)) continue
    if (FIXED_FLOW_CATEGORIES.includes(t.category)) continue
    sum += -t.amount
  }
  return toCents(sum)
}

/** Committed as a whole percent of income, or null when there is no income. */
export function committedShareOfIncome(committed: number, income: number): number | null {
  if (income <= 0) return null
  return Math.round((committed / income) * 100)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/finance/fixed-variable.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/fixed-variable.ts finance-tracker/web/lib/finance/fixed-variable.test.ts
git commit -m "feat(web): add fixed-vs-variable pure rollup logic"
```

---

### Task 2: The card — `components/dashboard/fixed-variable-card.tsx`

**Files:**
- Create: `finance-tracker/web/components/dashboard/fixed-variable-card.tsx`

**Interfaces:**
- Consumes: `totalCommittedMonthly`, `variableSpend`, `committedShareOfIncome` from `@/lib/finance/fixed-variable` (Task 1); `Card` from `@/components/ui/card`; `Bill`, `Transaction` from `@/lib/types`.
- Produces (Task 3 relies on this): `FixedVariableCard({ bills, transactions, month, income }: { bills: Bill[]; transactions: Transaction[]; month: string; income: number })` — `transactions` must be exploded rows; `month` is `'YYYY-MM'`.

- [ ] **Step 1: Write the component**

Create `finance-tracker/web/components/dashboard/fixed-variable-card.tsx` (server component, matching `budget-widget.tsx` idiom; layout is the approved figures-first Option A):

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import {
  totalCommittedMonthly,
  variableSpend,
  committedShareOfIncome,
} from '@/lib/finance/fixed-variable'
import type { Bill, Transaction } from '@/lib/types'

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export function FixedVariableCard({
  bills,
  transactions,
  month,
  income,
}: {
  bills: Bill[]
  transactions: Transaction[] // exploded rows
  month: string // 'YYYY-MM'
  income: number
}) {
  const committed = totalCommittedMonthly(bills)
  const variable = variableSpend(transactions, month)
  const share = committedShareOfIncome(committed, income)
  const total = committed + variable
  const fixedPct = total > 0 ? (committed / total) * 100 : 0
  const variablePct = total > 0 ? 100 - fixedPct : 0

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Fixed vs. variable</p>
        <Link href="/bills" className="text-xs font-medium text-primary hover:underline">
          Manage bills →
        </Link>
      </div>

      <div className="flex gap-8">
        <div>
          <p className="text-xl font-bold tabular-nums">
            {usd(committed)}
            <span className="text-sm font-medium text-muted-foreground">/mo</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Committed ({bills.length} {bills.length === 1 ? 'bill' : 'bills'})
          </p>
        </div>
        <div>
          <p className="text-xl font-bold tabular-nums">{usd(variable)}</p>
          <p className="text-xs text-muted-foreground">Variable this month</p>
        </div>
      </div>

      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${fixedPct}%` }} />
        <div className="h-full bg-primary/40" style={{ width: `${variablePct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-primary" />
          Committed {Math.round(fixedPct)}%
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-sm bg-primary/40" />
          Variable {Math.round(variablePct)}%
        </span>
      </div>

      {share !== null && (
        <p className="text-xs text-muted-foreground">
          Committed costs are{' '}
          <span className="font-medium text-foreground">{share}%</span> of this
          month&apos;s income
        </p>
      )}
    </Card>
  )
}
```

Notes for the implementer:
- When `total` is 0 both fills get `width: 0%`, leaving the `bg-muted` track empty — that is the spec's "empty muted track" state; no special-casing needed.
- The ratio caption is omitted entirely when `share` is `null` (no income).
- No `EmptyState` here: the card is meaningful even with zero bills (committed $0, all-variable bar).

- [ ] **Step 2: Verify the build**

Run (from `finance-tracker/web`): `npm run build`
Expected: build succeeds. (The component is not yet rendered anywhere; Next.js still typechecks it.)

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/components/dashboard/fixed-variable-card.tsx
git commit -m "feat(web): add fixed-vs-variable dashboard card"
```

---

### Task 3: Wire into the dashboard + verify

**Files:**
- Modify: `finance-tracker/web/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `FixedVariableCard` (Task 2); the page's existing `bills`, `exploded`, `month`, and `rows` values (all already computed).
- Produces: the finished, user-visible feature.

- [ ] **Step 1: Render the card on the dashboard**

In `finance-tracker/web/app/(app)/page.tsx`, add to the imports (alongside the other dashboard widgets):

```ts
import { FixedVariableCard } from '@/components/dashboard/fixed-variable-card'
```

In the widget grid at the bottom of the JSX, add the card after `RecentTransactionsWidget` (the 2-col grid wraps it onto a new row):

```tsx
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={exploded} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
        <FixedVariableCard
          bills={bills}
          transactions={exploded}
          month={month}
          income={rows[rows.length - 1]?.income ?? 0}
        />
      </div>
```

(`exploded` and `rows` already exist in the page; `rows[rows.length - 1]` is the current month because `trailingMonths` ends at `month`.)

- [ ] **Step 2: Verify the build and full test suite**

Run (from `finance-tracker/web`): `npm run build`
Expected: build succeeds.

Run: `npx vitest run`
Expected: entire suite passes (157 pre-existing tests + 11 new).

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`) and confirm on `/` (dashboard):

1. The **Fixed vs. variable** card appears as the fifth widget.
2. Committed matches the `/bills` page's "≈ $/mo across N bills" summary figure.
3. Variable excludes any `Bills & Utilities` and `Transfer` transactions this month (sanity-check against `/transactions` filtered by category).
4. The proportion bar and legend percentages are plausible (committed + variable shares sum to 100%).
5. The income caption reads "Committed costs are X% of this month's income" — and disappears if the month has no income.
6. "Manage bills →" navigates to `/bills`.

- [ ] **Step 4: Update project docs**

In `C:\Users\kharb\CLAUDE.md` (untracked project-instructions file — edit, no commit):
- Add a **"Fixed-vs-variable rollup (Plan 8)"** subsection to the Web App section, following the style of prior plan subsections: pure logic in `lib/finance/fixed-variable.ts` (`totalCommittedMonthly`/`variableSpend`/`committedShareOfIncome`), dashboard card `components/dashboard/fixed-variable-card.tsx`, A2 exclusion model (`Transfer` + `Bills & Utilities`), fed exploded rows, zero new queries.
- Add Plan 8 to the Plans list: `2026-07-18-fixed-variable-rollup.md` with its status.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/\(app\)/page.tsx
git commit -m "feat(web): show fixed-vs-variable card on the dashboard"
```

---

## Post-Implementation

- No migration, no env vars, no new queries — nothing to apply to Supabase.
- Mark this plan complete in `CLAUDE.md` once the manual smoke test passes.
