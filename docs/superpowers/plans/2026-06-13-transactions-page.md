# Transactions Page Implementation Plan (Plan 5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a month-scoped transactions page — filterable list, re-categorize/annotate any transaction, full manual create/edit/delete — backed by a controlled category list, with user category edits made sticky across Plaid syncs.

**Architecture:** A Server Component fetches the selected month's transactions + accounts (RLS-enforced) and hands them to a client view that filters in-memory (account/category/merchant) and navigates months via the URL. Mutations are Zod-validated Server Actions following the `app/auth/actions.ts` pattern. A controlled category vocabulary in `lib/finance/categories.ts` is shared by the UI and the Plaid mapper, and the Plan 4 sync is adjusted so it never overwrites a transaction's category once set.

**Tech Stack:** Next.js 16 (App Router, Server Actions, async `searchParams`) · React 19 (`useActionState`) · TypeScript · Zod 4 · `@supabase/ssr` · Vitest. UI uses existing shadcn primitives (`Button`, `Card`, `Input`) + native `<select>`/`<textarea>` + a Tailwind modal overlay (no new shadcn components — avoids Base-UI API guesswork).

**Design source:** `docs/superpowers/specs/2026-06-13-transactions-page-design.md`

**Scope:** Plan 5a only. No budgets/goals/bills (5b–5d), no dashboard/charts (5e), no transaction splitting (deferred). **No DB migration** — the schema already has `category`, `notes`, `is_manual`, `account_id`, `plaid_transaction_id`.

**Conventions:** All commands run from `finance-tracker/web/`. This is genuinely **Next.js 16** — Server Actions export from `'use server'` files; `searchParams` in a page is a **Promise** (`await searchParams`). When a Server Action calls `revalidatePath`, invoking it from a client transition auto-refreshes the route's Server Component; the client components below also call `router.refresh()` after success as belt-and-suspenders.

---

### Task 1: Controlled category list (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/categories.ts`
- Test: `finance-tracker/web/lib/finance/categories.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/categories.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CATEGORIES, mapPlaidCategory } from './categories'

describe('CATEGORIES', () => {
  it('includes the core categories and Uncategorized', () => {
    expect(CATEGORIES).toContain('Income')
    expect(CATEGORIES).toContain('Groceries')
    expect(CATEGORIES).toContain('Uncategorized')
  })
})

describe('mapPlaidCategory', () => {
  it('maps known Plaid primaries onto our list', () => {
    expect(mapPlaidCategory('FOOD_AND_DRINK')).toBe('Food And Drink')
    expect(mapPlaidCategory('TRANSPORTATION')).toBe('Transportation')
    expect(mapPlaidCategory('TRAVEL')).toBe('Travel')
    expect(mapPlaidCategory('INCOME')).toBe('Income')
    expect(mapPlaidCategory('RENT_AND_UTILITIES')).toBe('Bills & Utilities')
  })

  it('falls back to Uncategorized for unknown/empty', () => {
    expect(mapPlaidCategory('SOMETHING_NEW')).toBe('Uncategorized')
    expect(mapPlaidCategory(null)).toBe('Uncategorized')
    expect(mapPlaidCategory(undefined)).toBe('Uncategorized')
  })

  it('always returns a member of CATEGORIES', () => {
    const inputs = ['FOOD_AND_DRINK', 'TRANSPORTATION', 'WHATEVER', '', null]
    for (const i of inputs) {
      expect(CATEGORIES).toContain(mapPlaidCategory(i))
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/categories.test.ts`
Expected: FAIL — cannot find module `./categories`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/finance/categories.ts`:

```ts
/** Canonical category vocabulary shared by the UI dropdowns and the Plaid mapper. */
export const CATEGORIES = [
  'Income',
  'Groceries',
  'Food And Drink',
  'Transportation',
  'Travel',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Transfer',
  'Uncategorized',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Maps Plaid's personal_finance_category.primary onto our list. */
const PLAID_PRIMARY_TO_CATEGORY: Record<string, Category> = {
  INCOME: 'Income',
  TRANSFER_IN: 'Transfer',
  TRANSFER_OUT: 'Transfer',
  LOAN_PAYMENTS: 'Bills & Utilities',
  BANK_FEES: 'Bills & Utilities',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: 'Food And Drink',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Shopping',
  GENERAL_SERVICES: 'Shopping',
  GOVERNMENT_AND_NON_PROFIT: 'Bills & Utilities',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Health',
  RENT_AND_UTILITIES: 'Bills & Utilities',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
}

export function mapPlaidCategory(plaidPrimary: string | null | undefined): Category {
  if (!plaidPrimary) return 'Uncategorized'
  return PLAID_PRIMARY_TO_CATEGORY[plaidPrimary] ?? 'Uncategorized'
}

/** Type guard: is a string one of our categories? */
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/categories.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/categories.ts finance-tracker/web/lib/finance/categories.test.ts
git commit -m "feat(web): add controlled category list and Plaid category mapping"
```

---

### Task 2: Month helper (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/month.ts`
- Test: `finance-tracker/web/lib/finance/month.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/month.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { monthBounds, shiftMonth } from './month'

describe('monthBounds', () => {
  it('returns the first day of the month and of the next month', () => {
    expect(monthBounds('2026-06')).toEqual({ start: '2026-06-01', end: '2026-07-01' })
  })

  it('rolls the year over in December', () => {
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' })
  })
})

describe('shiftMonth', () => {
  it('moves forward and backward', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07')
    expect(shiftMonth('2026-06', -1)).toBe('2026-05')
  })

  it('crosses year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/month.test.ts`
Expected: FAIL — cannot find module `./month`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/finance/month.ts`:

```ts
/** First day of `yearMonth` ('YYYY-MM') and first day of the following month, as ISO 'YYYY-MM-DD'. */
export function monthBounds(yearMonth: string): { start: string; end: string } {
  const [y, m] = yearMonth.split('-').map(Number)
  const start = `${yearMonth}-01`
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  const end = `${ny}-${String(nm).padStart(2, '0')}-01`
  return { start, end }
}

/** Shift a 'YYYY-MM' string by `delta` months (handles year rollover). */
export function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/month.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/month.ts finance-tracker/web/lib/finance/month.test.ts
git commit -m "feat(web): add month bounds/shift helpers"
```

---

### Task 3: Point the Plaid mapper at the controlled category list

**Files:**
- Modify: `finance-tracker/web/lib/plaid/map.ts`
- Modify: `finance-tracker/web/lib/plaid/map.test.ts`

**Context:** `lib/plaid/map.ts` currently has a local `titleCaseCategory` used by `mapTransaction`. Replace it with `mapPlaidCategory` from Task 1 so synced transactions use the shared vocabulary.

- [ ] **Step 1: Update the mapper**

In `finance-tracker/web/lib/plaid/map.ts`:

Add this import at the top (below the existing `import type { AccountType } ...` line):

```ts
import { mapPlaidCategory } from '@/lib/finance/categories'
```

Delete the entire `titleCaseCategory` function (the `export function titleCaseCategory(...) { ... }` block).

In `mapTransaction`, change the `category` line from:

```ts
    category: titleCaseCategory(txn.personal_finance_category?.primary),
```

to:

```ts
    category: mapPlaidCategory(txn.personal_finance_category?.primary),
```

- [ ] **Step 2: Update the mapper test**

In `finance-tracker/web/lib/plaid/map.test.ts`:

Remove `titleCaseCategory` from the import (the import becomes `import { mapAccountType, mapTransaction, mapAccount, type PlaidTxnLike, type PlaidAccountLike } from './map'`).

Delete the entire `describe('titleCaseCategory', ...)` block.

In the `describe('mapTransaction', ...)` block, add this test (the existing `'maps category and marks the row non-manual'` test still passes because `mapPlaidCategory('FOOD_AND_DRINK')` is `'Food And Drink'`):

```ts
  it('falls back to Uncategorized when Plaid sends no category', () => {
    const row = mapTransaction(txn({ personal_finance_category: null }), 'user-1', accountIdByPlaidId)
    expect(row.category).toBe('Uncategorized')
  })
```

- [ ] **Step 3: Run the mapper tests**

Run: `npx vitest run lib/plaid/map.test.ts`
Expected: PASS (all `mapAccountType`, `mapTransaction`, `mapAccount` tests green; no `titleCaseCategory` references remain).

- [ ] **Step 4: Commit**

```bash
git add finance-tracker/web/lib/plaid/map.ts finance-tracker/web/lib/plaid/map.test.ts
git commit -m "refactor(web): map synced transactions onto the controlled category list"
```

---

### Task 4: Make synced categories sticky (Plan 4 sync change)

**Files:**
- Modify: `finance-tracker/web/app/api/sync/route.ts`
- Modify: `finance-tracker/web/app/api/sync/route.test.ts`

**Context:** Today the sync's `apply` callback upserts `[...added, ...modified]`, which overwrites `category` for existing rows. Change it so only **new** transactions set category; **modified** transactions update Plaid-owned fields but leave `category` (and `notes`/`is_manual`) untouched.

- [ ] **Step 1: Update the apply callback**

In `finance-tracker/web/app/api/sync/route.ts`, replace the entire `apply` callback body (the `async ({ added, modified, removedIds }) => { ... }` passed as the third argument to `runSync`) with:

```ts
        async ({ added, modified, removedIds }) => {
          // New transactions: insert with the mapped Plaid category.
          if (added.length > 0) {
            const rows = added.map((t) => mapTransaction(t, user.id, idMap))
            await supabase
              .from('transactions')
              .upsert(rows, { onConflict: 'user_id,plaid_transaction_id' })
          }
          // Existing transactions: update Plaid-owned fields but NOT category
          // (sticky category — preserves the user's re-categorization).
          for (const t of modified) {
            const row = mapTransaction(t, user.id, idMap)
            await supabase
              .from('transactions')
              .update({
                account_id: row.account_id,
                amount: row.amount,
                date: row.date,
                merchant_name: row.merchant_name,
              })
              .eq('user_id', user.id)
              .eq('plaid_transaction_id', row.plaid_transaction_id)
          }
          if (removedIds.length > 0) {
            await supabase
              .from('transactions')
              .delete()
              .eq('user_id', user.id)
              .in('plaid_transaction_id', removedIds)
          }
        },
```

- [ ] **Step 2: Add a regression test for the sticky behavior**

In `finance-tracker/web/app/api/sync/route.test.ts`, add this test inside the `describe('POST /api/sync', ...)` block (after the existing success test). It mirrors the existing success test's setup but supplies a `modified` transaction instead of an `added` one:

```ts
  it('updates Plaid fields but not category for modified transactions (sticky category)', async () => {
    const itemsStub = createQueryStub({
      data: [
        {
          id: 'item-1',
          user_id: 'user-1',
          plaid_item_id: 'plaid-item-1',
          encrypted_access_token: encryptToken('access-sandbox-1'),
          sync_cursor: 'cursor-prev',
          institution_name: 'Chase',
        },
      ],
      error: null,
    })
    const accountsStub = createQueryStub({
      data: [{ id: 'our-acct-1', plaid_account_id: 'pa-1' }],
      error: null,
    })
    const txStub = createQueryStub()

    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({
        tables: { plaid_items: itemsStub, accounts: accountsStub, transactions: txStub },
      }) as never,
    )

    mockedCreatePlaid.mockReturnValue({
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 500 } },
          ],
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [],
          modified: [
            {
              transaction_id: 'ptxn-1',
              account_id: 'pa-1',
              amount: 40,
              date: '2026-06-02',
              name: 'Groceries',
              merchant_name: 'Trader Joe’s',
              personal_finance_category: { primary: 'FOOD_AND_DRINK' },
            },
          ],
          removed: [],
          next_cursor: 'cursor-final',
          has_more: false,
        },
      }),
    } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ added: 0, modified: 1, removed: 0 })

    // Modified path uses update, not upsert, and the update payload omits category.
    expect(txStub.update).toHaveBeenCalled()
    const updatePayload = txStub.update.mock.calls[0][0] as Record<string, unknown>
    expect(updatePayload).not.toHaveProperty('category')
    expect(updatePayload).toHaveProperty('amount')
    expect(txStub.upsert).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run the sync tests**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS — the original 401 + success tests plus the new sticky-category test (3 total).

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all suites green (Plan 3/4 suites + categories, month, updated map + sync).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/api/sync/route.ts finance-tracker/web/app/api/sync/route.test.ts
git commit -m "feat(web): preserve user category edits across syncs (sticky category)"
```

---

### Task 5: Transactions Server Actions (TDD)

**Files:**
- Create: `finance-tracker/web/app/(app)/transactions/actions.ts`
- Test: `finance-tracker/web/app/(app)/transactions/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/(app)/transactions/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import {
  saveManualTransaction,
  updateTransactionCategory,
  deleteManualTransaction,
} from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

describe('saveManualTransaction', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: 'X', category: 'Groceries', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a missing merchant', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: '', category: 'Groceries', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a category not in the list', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-01', merchant_name: 'X', category: 'Nonsense', amount: '10', type: 'expense' }),
    )
    expect(res.error).toBeTruthy()
  })

  it('stores an expense as a negative amount with is_manual', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await saveManualTransaction(
      {},
      fd({ date: '2026-06-02', merchant_name: 'Coffee', category: 'Food And Drink', amount: '4.50', type: 'expense' }),
    )
    expect(res.success).toBe(true)
    expect(txns.insert).toHaveBeenCalledOnce()
    const row = txns.insert.mock.calls[0][0] as Record<string, unknown>
    expect(row.amount).toBe(-4.5)
    expect(row.is_manual).toBe(true)
    expect(row.category).toBe('Food And Drink')
  })

  it('stores income as a positive amount', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    await saveManualTransaction(
      {},
      fd({ date: '2026-06-02', merchant_name: 'Paycheck', category: 'Income', amount: '2000', type: 'income' }),
    )
    expect((txns.insert.mock.calls[0][0] as Record<string, unknown>).amount).toBe(2000)
  })
})

describe('updateTransactionCategory', () => {
  it('updates only category and notes', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await updateTransactionCategory(
      {},
      fd({ id: '11111111-1111-1111-1111-111111111111', category: 'Travel', notes: 'trip' }),
    )
    expect(res.success).toBe(true)
    expect(txns.update).toHaveBeenCalledWith({ category: 'Travel', notes: 'trip' })
  })

  it('rejects a bad category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await updateTransactionCategory({}, fd({ id: 'x', category: 'Bogus', notes: '' }))
    expect(res.error).toBeTruthy()
  })
})

describe('deleteManualTransaction', () => {
  it('deletes filtered by is_manual = true', async () => {
    const txns = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await deleteManualTransaction('11111111-1111-1111-1111-111111111111')
    expect(res.success).toBe(true)
    expect(txns.delete).toHaveBeenCalled()
    expect(txns.eq).toHaveBeenCalledWith('is_manual', true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(app)/transactions/actions.test.ts"`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/(app)/transactions/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isCategory } from '@/lib/finance/categories'

export type ActionState = { error?: string; success?: boolean }

const categoryField = z.string().refine(isCategory, 'Please choose a valid category')

const manualSchema = z.object({
  id: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid date is required'),
  merchant_name: z.string().min(1, 'Merchant is required'),
  category: categoryField,
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  type: z.enum(['expense', 'income']),
  account_id: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  notes: z.string().optional().default(''),
})

export async function saveManualTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = manualSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, type, amount, account_id, date, merchant_name, category, notes } = parsed.data
  const signedAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount)
  const row = {
    user_id: user.id,
    account_id,
    date,
    merchant_name,
    category,
    notes,
    amount: signedAmount,
    is_manual: true,
  }

  const { error } = id
    ? await supabase.from('transactions').update(row).eq('id', id).eq('is_manual', true)
    : await supabase.from('transactions').insert(row)

  if (error) return { error: 'Could not save the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}

const categorySchema = z.object({
  id: z.string().min(1),
  category: categoryField,
  notes: z.string().optional().default(''),
})

export async function updateTransactionCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = categorySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, category, notes } = parsed.data
  const { error } = await supabase.from('transactions').update({ category, notes }).eq('id', id)
  if (error) return { error: 'Could not update the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}

export async function deleteManualTransaction(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('transactions').delete().eq('id', id).eq('is_manual', true)
  if (error) return { error: 'Could not delete the transaction.' }
  revalidatePath('/transactions')
  return { success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/(app)/transactions/actions.test.ts"`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/app/(app)/transactions/actions.ts" "finance-tracker/web/app/(app)/transactions/actions.test.ts"
git commit -m "feat(web): add transactions server actions (manual CRUD + recategorize)"
```

---

### Task 6: Transactions page + view (server fetch, filter toolbar, list)

**Files:**
- Modify: `finance-tracker/web/app/(app)/transactions/page.tsx` (replace the placeholder)
- Create: `finance-tracker/web/components/transactions/transactions-view.tsx`

- [ ] **Step 1: Replace the page with a server fetch**

Replace the entire contents of `finance-tracker/web/app/(app)/transactions/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import { monthBounds } from '@/lib/finance/month'
import { TransactionsView } from '@/components/transactions/transactions-view'
import type { Account, Transaction } from '@/lib/types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth()
  const { start, end } = monthBounds(ym)

  const supabase = await createClient()
  const [{ data: txns }, { data: accts }] = await Promise.all([
    supabase
      .from('transactions')
      .select('*')
      .gte('date', start)
      .lt('date', end)
      .order('date', { ascending: false }),
    supabase.from('accounts').select('*').order('name'),
  ])

  return (
    <TransactionsView
      month={ym}
      transactions={(txns ?? []) as Transaction[]}
      accounts={(accts ?? []) as Account[]}
    />
  )
}
```

- [ ] **Step 2: Create the client view**

Create `finance-tracker/web/components/transactions/transactions-view.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { CATEGORIES } from '@/lib/finance/categories'
import { shiftMonth } from '@/lib/finance/month'
import { TransactionForm } from './transaction-form'
import type { Account, Transaction } from '@/lib/types'

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm'

export function TransactionsView({
  month,
  transactions,
  accounts,
}: {
  month: string
  transactions: Transaction[]
  accounts: Account[]
}) {
  const router = useRouter()
  const [accountFilter, setAccountFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [creating, setCreating] = useState(false)

  const accountName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of accounts) m[a.id] = a.name
    return m
  }, [accounts])

  const filtered = useMemo(
    () =>
      transactions.filter((t) => {
        if (accountFilter !== 'all' && t.account_id !== accountFilter) return false
        if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
        if (search && !t.merchant_name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      }),
    [transactions, accountFilter, categoryFilter, search],
  )

  function gotoMonth(delta: number) {
    router.push(`/transactions?month=${shiftMonth(month, delta)}`)
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <Button onClick={() => setCreating(true)}>+ Add transaction</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => gotoMonth(-1)}>
          ←
        </Button>
        <span className="min-w-24 text-center text-sm font-medium">{month}</span>
        <Button variant="outline" size="sm" onClick={() => gotoMonth(1)}>
          →
        </Button>

        <select
          aria-label="Filter by account"
          className={selectClass}
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by category"
          className={selectClass}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <Input
          className="w-48"
          placeholder="Search merchant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No transactions"
          hint="Add a manual transaction, or connect a bank and sync."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className="flex cursor-pointer items-center justify-between p-3"
              onClick={() => setEditing(t)}
            >
              <div className="flex flex-col">
                <span className="font-medium">{t.merchant_name}</span>
                <span className="text-xs text-muted-foreground">
                  {t.date} · {t.account_id ? accountName[t.account_id] ?? '—' : 'No account'}
                  {t.is_manual ? ' · manual' : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t.category}</span>
                <span
                  className={
                    t.amount < 0 ? 'font-semibold text-red-600' : 'font-semibold text-green-600'
                  }
                >
                  {t.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TransactionForm
          accounts={accounts}
          transaction={editing}
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

- [ ] **Step 3: Verify the build (form not created yet — expect a known error)**

Run: `npx tsc --noEmit`
Expected: ONE error — `transactions-view.tsx` cannot resolve `'./transaction-form'`. That module arrives in Task 7. Do not try to fix it here. (If you see any *other* error, fix that one.)

- [ ] **Step 4: Commit**

```bash
git add "finance-tracker/web/app/(app)/transactions/page.tsx" finance-tracker/web/components/transactions/transactions-view.tsx
git commit -m "feat(web): add transactions page server fetch and filter/list view"
```

---

### Task 7: Transaction add/edit/delete dialog

**Files:**
- Create: `finance-tracker/web/components/transactions/transaction-form.tsx`

- [ ] **Step 1: Create the form dialog**

Create `finance-tracker/web/components/transactions/transaction-form.tsx`:

```tsx
'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { CATEGORIES } from '@/lib/finance/categories'
import {
  saveManualTransaction,
  updateTransactionCategory,
  deleteManualTransaction,
  type ActionState,
} from '@/app/(app)/transactions/actions'
import type { Account, Transaction } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export function TransactionForm({
  accounts,
  transaction,
  onClose,
}: {
  accounts: Account[]
  transaction: Transaction | null
  onClose: () => void
}) {
  const router = useRouter()
  const isManual = transaction ? transaction.is_manual : true
  const [state, formAction, pending] = useActionState(
    isManual ? saveManualTransaction : updateTransactionCategory,
    initial,
  )

  useEffect(() => {
    if (state.success) {
      toast.success('Transaction saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const t = transaction
  const defaultType = t ? (t.amount < 0 ? 'expense' : 'income') : 'expense'

  async function handleDelete() {
    if (!t) return
    const res = await deleteManualTransaction(t.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Transaction deleted')
      router.refresh()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card className="w-full max-w-md space-y-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">
          {t ? (isManual ? 'Edit transaction' : 'Edit category') : 'Add transaction'}
        </h2>

        <form action={formAction} className="space-y-3">
          {t && <input type="hidden" name="id" value={t.id} />}

          {isManual ? (
            <>
              <div>
                <label className="text-sm">Date</label>
                <Input type="date" name="date" defaultValue={t?.date ?? ''} required />
              </div>
              <div>
                <label className="text-sm">Merchant</label>
                <Input name="merchant_name" defaultValue={t?.merchant_name ?? ''} required />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-sm">Type</label>
                  <select name="type" defaultValue={defaultType} className={fieldClass}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm">Amount</label>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={t ? Math.abs(t.amount) : ''}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm">Account (optional)</label>
                <select name="account_id" defaultValue={t?.account_id ?? ''} className={fieldClass}>
                  <option value="">No account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="font-medium">{t!.merchant_name}</p>
              <p className="text-muted-foreground">
                {t!.date} ·{' '}
                {t!.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} · synced
                (amount/date locked)
              </p>
            </div>
          )}

          <div>
            <label className="text-sm">Category</label>
            <select name="category" defaultValue={t?.category ?? 'Uncategorized'} className={fieldClass}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm">Notes</label>
            <textarea
              name="notes"
              defaultValue={t?.notes ?? ''}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {t && isManual ? (
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

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: build succeeds; `/transactions` is listed. `npx tsc --noEmit` is clean (the Task 6 import now resolves).

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/components/transactions/transaction-form.tsx
git commit -m "feat(web): add transaction add/edit/delete dialog"
```

---

### Task 8: Full verification & docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — categories, month, transactions actions, updated map + sync suites, and all prior Plan 3/4 suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds; route list includes `/transactions`; `npx tsc --noEmit` clean.

- [ ] **Step 3: Manual smoke test (requires the running app + a synced bank)**

Performed by the human operator with `.env.local` configured and the dev server running (`npm run dev`):
1. Go to `/transactions` → current month's synced transactions show, expenses red/negative, income green/positive.
2. Click **+ Add transaction** → add an expense (e.g. Coffee, Food And Drink, $4.50) → it appears negative/red; add an income → appears positive/green.
3. Click a **synced** transaction → amount/date/merchant are read-only; change its **category** and save → the badge updates.
4. Click **Sync now** on `/accounts`, return to `/transactions` → the re-categorized synced transaction **kept your category** (sticky).
5. Use the month arrows, account/category filters, and merchant search → list narrows correctly; empty months show the empty state.
6. Open a **manual** transaction → **Delete** removes it; confirm a **synced** transaction shows no Delete button.

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", add below the Plan 4 line:

```markdown
- Plan 5 — Feature pages (decomposed): **5a Transactions** (`2026-06-13-transactions-page.md`) — **in progress** (controlled categories, sticky synced-category, month-scoped list, manual CRUD). Remaining: 5b Budgets, 5c Goals, 5d Bills, 5e Dashboard + cashflow charts.
```

Under the "## Web App" section, add a bullet to the feature notes:

```markdown
- Categories: a controlled list in `lib/finance/categories.ts` backs every category dropdown; Plaid categories map onto it (`mapPlaidCategory`). Sync is "sticky" — it never overwrites a transaction's `category` on `modified`, so user re-categorizations persist. Transactions UI uses native `<select>`/`<textarea>` + a Tailwind modal (not shadcn Dialog/Select).
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Plan 5a transactions in progress"
```

---

## Done criteria

- `npx vitest run` green (categories, month, transactions actions, updated map + sync, all prior suites).
- `npm run build` succeeds with `/transactions` rendering the month-scoped list.
- Controlled category list backs every dropdown; synced transactions use it.
- Manual transactions: full create/edit/delete with correct amount signs; synced transactions are category/notes-only (no delete, read-only amount/date/merchant).
- A user's category edit on a synced transaction survives a subsequent **Sync now**.
- No splitting, no dashboard/charts, no budgets/goals/bills — those are later plans.
