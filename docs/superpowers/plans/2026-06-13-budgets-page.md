# Budgets Page Implementation Plan (Plan 5b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a month-scoped `/budgets` page — one budget per spending category, with progress bars of the selected month's spending vs. each limit (under/near/over colors) and create/edit/delete.

**Architecture:** A Server Component fetches the user's budgets + the selected month's transactions (RLS-enforced) and passes them to a client view that computes spend/status per budget with the existing pure `lib/finance/budget.ts` helpers. Create/edit/delete are Zod-validated Server Actions; `saveBudget` upserts on a new `unique (user_id, category)` constraint. Categories are restricted to a `SPENDING_CATEGORIES` subset. UI reuses the 5a patterns (native `<select>` + Tailwind modal + existing Button/Card/Input).

**Tech Stack:** Next.js 16 (App Router, Server Actions, async `searchParams`) · React 19 (`useActionState`) · TypeScript · Zod 4 · `@supabase/ssr` · Vitest.

**Design source:** `docs/superpowers/specs/2026-06-13-budgets-page-design.md`

**Scope:** Plan 5b only. No goals/bills (5c/5d), no dashboard/charts or multi-month comparison (5e). Reuses `spentThisMonth`/`budgetRemaining` (Plan 3), `monthBounds`/`shiftMonth` and `CATEGORIES`/`isCategory` (Plan 5a) unchanged.

**Conventions:** All commands run from `finance-tracker/web/`. Next.js 16: page `searchParams` is a Promise (`await searchParams`); Server Actions live in `'use server'` files. **Manual step the engineer can't do:** applying `0003_budget_unique.sql` to Supabase (done in Task 6's manual smoke test). All automated tests mock Supabase and need no migration applied.

---

### Task 1: Spending-category subset (TDD)

**Files:**
- Modify: `finance-tracker/web/lib/finance/categories.ts`
- Modify: `finance-tracker/web/lib/finance/categories.test.ts`

- [ ] **Step 1: Extend the test**

In `finance-tracker/web/lib/finance/categories.test.ts`, change the import line to:

```ts
import { CATEGORIES, mapPlaidCategory, SPENDING_CATEGORIES, isSpendingCategory } from './categories'
```

Add these two `describe` blocks at the end of the file:

```ts
describe('SPENDING_CATEGORIES', () => {
  it('excludes Income and Transfer', () => {
    expect(SPENDING_CATEGORIES).not.toContain('Income')
    expect(SPENDING_CATEGORIES).not.toContain('Transfer')
  })

  it('includes spending categories, including Uncategorized', () => {
    expect(SPENDING_CATEGORIES).toContain('Groceries')
    expect(SPENDING_CATEGORIES).toContain('Food And Drink')
    expect(SPENDING_CATEGORIES).toContain('Uncategorized')
  })
})

describe('isSpendingCategory', () => {
  it('is true for spending categories, false for Income/Transfer/unknown', () => {
    expect(isSpendingCategory('Groceries')).toBe(true)
    expect(isSpendingCategory('Uncategorized')).toBe(true)
    expect(isSpendingCategory('Income')).toBe(false)
    expect(isSpendingCategory('Transfer')).toBe(false)
    expect(isSpendingCategory('Not A Category')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/categories.test.ts`
Expected: FAIL — `SPENDING_CATEGORIES`/`isSpendingCategory` are not exported.

- [ ] **Step 3: Implement**

In `finance-tracker/web/lib/finance/categories.ts`, append at the end of the file:

```ts
/** Categories you can budget — spending only (excludes Income and Transfer). */
export const SPENDING_CATEGORIES: readonly Category[] = CATEGORIES.filter(
  (c) => c !== 'Income' && c !== 'Transfer',
)

/** Type guard: is a string a budgetable spending category? */
export function isSpendingCategory(value: unknown): value is Category {
  return isCategory(value) && value !== 'Income' && value !== 'Transfer'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/categories.test.ts`
Expected: PASS (all prior + the 2 new blocks).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/categories.ts finance-tracker/web/lib/finance/categories.test.ts
git commit -m "feat(web): add SPENDING_CATEGORIES subset for budgets"
```

---

### Task 2: Budget status helper (TDD)

**Files:**
- Modify: `finance-tracker/web/lib/finance/budget.ts`
- Modify: `finance-tracker/web/lib/finance/budget.test.ts`

- [ ] **Step 1: Extend the test**

In `finance-tracker/web/lib/finance/budget.test.ts`, change the import line to:

```ts
import { spentThisMonth, budgetRemaining, budgetStatus } from './budget'
```

Add this `describe` block at the end of the file:

```ts
describe('budgetStatus', () => {
  it('is under below 80% of the limit', () => {
    expect(budgetStatus(79, 100)).toBe('under')
  })

  it('is near from 80% up to and including 100%', () => {
    expect(budgetStatus(80, 100)).toBe('near')
    expect(budgetStatus(100, 100)).toBe('near')
  })

  it('is over above 100%', () => {
    expect(budgetStatus(101, 100)).toBe('over')
  })

  it('handles a zero limit', () => {
    expect(budgetStatus(0, 0)).toBe('under')
    expect(budgetStatus(5, 0)).toBe('over')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/budget.test.ts`
Expected: FAIL — `budgetStatus` is not exported.

- [ ] **Step 3: Implement**

In `finance-tracker/web/lib/finance/budget.ts`, append at the end of the file:

```ts
/** Budget health for the UI: 'over' when spend exceeds the limit, 'near' at >=80% of it, else 'under'. */
export function budgetStatus(spent: number, limit: number): 'under' | 'near' | 'over' {
  if (limit <= 0) return spent > 0 ? 'over' : 'under'
  if (spent > limit) return 'over'
  if (spent >= 0.8 * limit) return 'near'
  return 'under'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/budget.test.ts`
Expected: PASS (prior tests + the 4 new cases).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/budget.ts finance-tracker/web/lib/finance/budget.test.ts
git commit -m "feat(web): add budgetStatus (under/near/over) helper"
```

---

### Task 3: Unique-constraint migration

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0003_budget_unique.sql`

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0003_budget_unique.sql`:

```sql
-- One budget per category per user. Enables saveBudget to upsert on conflict.
alter table budgets add constraint budgets_user_category_unique unique (user_id, category);
```

- [ ] **Step 2: Verify the SQL is well-formed**

There is no automated test (it's applied via the Supabase dashboard in Task 6). Read the file once and confirm it adds a single `unique (user_id, category)` constraint to `budgets`.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/supabase/migrations/0003_budget_unique.sql
git commit -m "feat(web): add unique (user_id, category) budgets constraint"
```

---

### Task 4: Budget Server Actions (TDD)

**Files:**
- Create: `finance-tracker/web/app/(app)/budgets/actions.ts`
- Test: `finance-tracker/web/app/(app)/budgets/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/(app)/budgets/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveBudget, deleteBudget } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('saveBudget', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '400' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-spending category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveBudget({}, fd({ category: 'Income', monthly_limit: '400' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-positive limit', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '0' }))
    expect(res.error).toBeTruthy()
  })

  it('upserts on conflict user_id,category for valid input', async () => {
    const budgets = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { budgets } }) as never)
    const res = await saveBudget({}, fd({ category: 'Groceries', monthly_limit: '400' }))
    expect(res.success).toBe(true)
    expect(budgets.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'Groceries', monthly_limit: 400 }),
      { onConflict: 'user_id,category' },
    )
  })
})

describe('deleteBudget', () => {
  it('deletes by id', async () => {
    const budgets = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { budgets } }) as never)
    const res = await deleteBudget('11111111-1111-1111-1111-111111111111')
    expect(res.success).toBe(true)
    expect(budgets.delete).toHaveBeenCalled()
    expect(budgets.eq).toHaveBeenCalledWith('id', '11111111-1111-1111-1111-111111111111')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(app)/budgets/actions.test.ts"`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/(app)/budgets/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSpendingCategory } from '@/lib/finance/categories'

export type ActionState = { error?: string; success?: boolean }

const budgetSchema = z.object({
  category: z.string().refine(isSpendingCategory, 'Please choose a spending category'),
  monthly_limit: z.coerce.number().positive('Limit must be greater than 0'),
})

export async function saveBudget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = budgetSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { category, monthly_limit } = parsed.data
  const { error } = await supabase
    .from('budgets')
    .upsert({ user_id: user.id, category, monthly_limit }, { onConflict: 'user_id,category' })

  if (error) return { error: 'Could not save the budget.' }
  revalidatePath('/budgets')
  return { success: true }
}

export async function deleteBudget(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('budgets').delete().eq('id', id)
  if (error) return { error: 'Could not delete the budget.' }
  revalidatePath('/budgets')
  return { success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/(app)/budgets/actions.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/app/(app)/budgets/actions.ts" "finance-tracker/web/app/(app)/budgets/actions.test.ts"
git commit -m "feat(web): add budgets server actions (upsert + delete)"
```

---

### Task 5: Budgets UI — form, view, and page

Create the three files in dependency order (form → view → page) so every commit compiles. Build, then make TWO commits.

**Files:**
- Create: `finance-tracker/web/components/budgets/budget-form.tsx`
- Create: `finance-tracker/web/components/budgets/budgets-view.tsx`
- Modify: `finance-tracker/web/app/(app)/budgets/page.tsx` (replace the placeholder)

- [ ] **Step 1: Create the budget form**

Create `finance-tracker/web/components/budgets/budget-form.tsx`:

```tsx
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { saveBudget, deleteBudget, type ActionState } from '@/app/(app)/budgets/actions'
import type { Budget } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function BudgetForm({
  budget,
  budgetedCategories,
  onClose,
}: {
  budget: Budget | null
  budgetedCategories: string[]
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveBudget, initial)

  useEffect(() => {
    if (state.success) {
      toast.success('Budget saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const b = budget
  const available = SPENDING_CATEGORIES.filter((c) => !budgetedCategories.includes(c))

  async function handleDelete() {
    if (!b) return
    const res = await deleteBudget(b.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Budget deleted')
      router.refresh()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-sm space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{b ? 'Edit budget' : 'Add budget'}</h2>
        <form action={formAction} className="space-y-3">
          <div>
            <label className="text-sm">Category</label>
            {b ? (
              <>
                <input type="hidden" name="category" value={b.category} />
                <p className="rounded-md bg-muted px-3 py-2 text-sm">{b.category}</p>
              </>
            ) : (
              <select name="category" className={fieldClass} defaultValue={available[0] ?? ''} required>
                {available.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="text-sm">Monthly limit</label>
            <Input
              name="monthly_limit"
              type="number"
              step="0.01"
              min="0"
              defaultValue={b?.monthly_limit ?? ''}
              required
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {b ? (
              <Button type="button" variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create the budgets view**

Create `finance-tracker/web/components/budgets/budgets-view.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { spentThisMonth, budgetRemaining, budgetStatus } from '@/lib/finance/budget'
import { shiftMonth } from '@/lib/finance/month'
import { BudgetForm } from './budget-form'
import type { Budget, Transaction } from '@/lib/types'

const STATUS_BAR: Record<'under' | 'near' | 'over', string> = {
  under: 'bg-green-600',
  near: 'bg-amber-500',
  over: 'bg-red-600',
}
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function BudgetsView({
  month,
  budgets,
  transactions,
}: {
  month: string
  budgets: Budget[]
  transactions: Transaction[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<Budget | null>(null)
  const [creating, setCreating] = useState(false)
  const [year, mon] = month.split('-').map(Number)
  const budgetedCategories = budgets.map((b) => b.category)

  function gotoMonth(delta: number) {
    router.push(`/budgets?month=${shiftMonth(month, delta)}`)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Budgets</h1>
        <Button onClick={() => setCreating(true)}>+ Add budget</Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => gotoMonth(-1)}>
          ←
        </Button>
        <span className="min-w-24 text-center text-sm font-medium">{month}</span>
        <Button variant="outline" size="sm" onClick={() => gotoMonth(1)}>
          →
        </Button>
      </div>

      {budgets.length === 0 ? (
        <EmptyState title="No budgets yet" hint="Add a category budget to track your spending." />
      ) : (
        <div className="space-y-2">
          {budgets.map((b) => {
            const spent = spentThisMonth(transactions, b.category, year, mon)
            const remaining = budgetRemaining(b.monthly_limit, spent)
            const status = budgetStatus(spent, b.monthly_limit)
            const pct = b.monthly_limit > 0 ? Math.min(100, (spent / b.monthly_limit) * 100) : 100
            return (
              <Card
                key={b.id}
                className="cursor-pointer space-y-2 p-4"
                onClick={() => setEditing(b)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{b.category}</span>
                  <span className="text-sm text-muted-foreground">
                    {usd(spent)} of {usd(b.monthly_limit)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className={`h-full ${STATUS_BAR[status]}`} style={{ width: `${pct}%` }} />
                </div>
                <p className={`text-xs ${status === 'over' ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {remaining >= 0 ? `${usd(remaining)} left` : `${usd(-remaining)} over`}
                </p>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <BudgetForm
          budget={editing}
          budgetedCategories={budgetedCategories}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 3: Replace the placeholder page**

Replace the ENTIRE contents of `finance-tracker/web/app/(app)/budgets/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import { monthBounds } from '@/lib/finance/month'
import { BudgetsView } from '@/components/budgets/budgets-view'
import type { Budget, Transaction } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth()
  const { start, end } = monthBounds(ym)

  const supabase = await createClient()
  const [{ data: budgets }, { data: txns }] = await Promise.all([
    supabase.from('budgets').select('*').order('category'),
    supabase.from('transactions').select('*').gte('date', start).lt('date', end),
  ])

  return (
    <BudgetsView
      month={ym}
      budgets={(budgets ?? []) as Budget[]}
      transactions={(txns ?? []) as Transaction[]}
    />
  )
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds; route list includes `/budgets`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit (two commits, both compile)**

```bash
git add finance-tracker/web/components/budgets/budget-form.tsx
git commit -m "feat(web): add budget add/edit/delete dialog"
git add "finance-tracker/web/app/(app)/budgets/page.tsx" finance-tracker/web/components/budgets/budgets-view.tsx
git commit -m "feat(web): add budgets page with month-scoped progress bars"
```

---

### Task 6: Full verification & docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — extended categories + budget suites, budgets actions, and all prior suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds; route list includes `/budgets`; `npx tsc --noEmit` clean.

- [ ] **Step 3: Manual smoke test (requires the running app + a synced bank)**

Performed by the human operator with the dev server running (`npm run dev`):
1. Apply `finance-tracker/web/supabase/migrations/0003_budget_unique.sql` in the Supabase SQL editor. Confirm the `budgets_user_category_unique` constraint exists.
2. Go to `/budgets` → empty state. Click **+ Add budget** → the category dropdown lists spending categories only (no Income/Transfer). Add e.g. Groceries $400.
3. The row shows a progress bar of this month's Groceries spending vs. $400, colored: green under 80%, amber 80–100%, red over 100%. (Re-categorize transactions on `/transactions` to push spend up if needed.)
4. Click the row → edit the limit; **Delete** removes the budget.
5. Add a second budget; confirm the create dropdown no longer offers an already-budgeted category.
6. Use the month arrows → `spent` recomputes for the selected month while the limit stays the same.

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", update the Plan 5 line to mark 5b in progress:

```markdown
- Plan 5 — Feature pages (decomposed): 5a Transactions **complete**; **5b Budgets** (`2026-06-13-budgets-page.md`) — **in progress** (one budget per spending category, month-scoped progress bars, CRUD). Remaining: 5c Goals, 5d Bills, 5e Dashboard + cashflow charts.
```

Under the "## Web App" section's category notes, add:

```markdown
- Budgets (5b): one per category (`unique (user_id, category)`, migration `0003`), restricted to `SPENDING_CATEGORIES` (controlled list minus Income/Transfer). `/budgets` is month-scoped; rows show `spentThisMonth` vs. limit colored by `budgetStatus` (under/near/over). `saveBudget` upserts on the unique key.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Plan 5b budgets in progress"
```

---

## Done criteria

- `npx vitest run` green (extended categories + budget tests, budgets actions, all prior suites).
- `npm run build` succeeds with `/budgets` rendering month-scoped budget rows.
- One budget per category enforced; only spending categories budgetable.
- Progress bars show the selected month's spend vs. limit with under/near/over colors; month nav recomputes spend.
- Create/edit/delete work via the upsert action.
- No goals/bills/dashboard, no multi-month comparison — those are later plans.
