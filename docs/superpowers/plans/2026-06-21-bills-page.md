# Bills Page Implementation Plan (Plan 5d)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/bills` page — recurring bills (all four frequencies) with computed next-due dates, an auto-resetting paid/due status, a normalized monthly-cost summary, and create/edit/delete.

**Architecture:** A Server Component fetches the user's bills (RLS) and passes them to a client view that computes due dates / paid status / monthly cost with pure helpers in `lib/finance/bill.ts` (extends Plan 3's existing file). Create/edit/delete/mark-paid are Zod-validated Server Actions. Paid status is driven by a new `last_paid_date` column; quarterly/yearly due dates are anchored by a new `due_month` column. UI reuses the budgets/goals patterns (Tailwind-overlay modal + existing Button/Card/Input).

**Tech Stack:** Next.js 16 (App Router, Server Actions) · React 19 (`useActionState`) · TypeScript · Zod 4 · `@supabase/ssr` · Vitest.

**Design source:** `docs/superpowers/specs/2026-06-21-bills-page-design.md`

**Scope:** Plan 5d only. No fixed/variable dashboard rollups, no transaction linking, no reminders, no payment history (all deferred to 5e or later). `lib/finance/bill.ts` **pre-exists** (Plan 3) with tested `nextDueDate` (weekly/monthly) + `daysUntilDue` — extend it, don't rewrite.

**Conventions:** All commands run from `finance-tracker/web/`. Route paths contain parens (`app/(app)/bills/`) — quote them in shell. Tests mock Supabase via `lib/plaid/test-helpers` and need no DB. **Manual step the engineer can't do:** applying `0004_bills_scheduling.sql` to Supabase (done in Task 5's smoke test).

---

### Task 1: Schema migration + `Bill` type + test factory

Replaces the single `is_paid` boolean with `last_paid_date`, and adds the `due_month`
anchor. No behavior change yet — existing `bill.ts` tests stay green.

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0004_bills_scheduling.sql`
- Modify: `finance-tracker/web/lib/types.ts`
- Modify: `finance-tracker/web/lib/finance/bill.test.ts` (the `bill()` factory only)

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0004_bills_scheduling.sql`:

```sql
-- Bills: support quarterly/yearly anchoring and auto-resetting paid status.
alter table bills add column due_month smallint;      -- anchor month (1–12) for quarterly/yearly
alter table bills add column last_paid_date date;      -- null = unpaid this cycle
alter table bills drop column is_paid;                 -- replaced by last_paid_date
```

- [ ] **Step 2: Update the `Bill` type**

In `finance-tracker/web/lib/types.ts`, replace the entire `Bill` interface with:

```ts
export interface Bill {
  id: string
  user_id: string
  name: string
  amount: number
  due_day: number // monthly/quarterly/yearly: day-of-month 1–31; weekly: day-of-week 0–6 (Sun=0)
  due_month?: number | null // 1–12 anchor for quarterly/yearly; null/unused otherwise
  frequency: BillFrequency
  category: string
  last_paid_date?: string | null // ISO 'YYYY-MM-DD'; null = unpaid this cycle
}
```

- [ ] **Step 3: Update the test factory**

In `finance-tracker/web/lib/finance/bill.test.ts`, replace the `bill()` factory (it currently sets `is_paid` and a non-controlled category) with:

```ts
function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
    due_month: null, last_paid_date: null, ...partial,
  }
}
```

- [ ] **Step 4: Verify existing tests still pass + typecheck**

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: PASS (the existing weekly/monthly/deferred/daysUntilDue tests — unchanged behavior).
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/supabase/migrations/0004_bills_scheduling.sql" finance-tracker/web/lib/types.ts finance-tracker/web/lib/finance/bill.test.ts
git commit -m "feat(web): bills schema — add due_month + last_paid_date, drop is_paid"
```

---

### Task 2: Extend `lib/finance/bill.ts` (quarterly/yearly + paid/cost helpers) — TDD

**Files:**
- Modify: `finance-tracker/web/lib/finance/bill.ts`
- Modify: `finance-tracker/web/lib/finance/bill.test.ts`

- [ ] **Step 1: Write the failing tests**

In `finance-tracker/web/lib/finance/bill.test.ts`, update the import line to:

```ts
import { nextDueDate, daysUntilDue, mostRecentDueDate, isPaid, monthlyCost } from './bill'
```

**Delete** the existing `describe('nextDueDate (deferred frequencies)', …)` block (quarterly/yearly no longer return null). Then append these blocks at the end of the file:

```ts
describe('nextDueDate (yearly)', () => {
  it('returns this year when the month/day is still ahead', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 12, due_day: 25 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-12-25')
  })

  it('rolls to next year when the date has passed', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 3, due_day: 10 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-03-10')
  })

  it('clamps the day to the month length', () => {
    const due = nextDueDate(bill({ frequency: 'yearly', due_month: 2, due_day: 31 }), d('2026-03-01'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-02-28')
  })
})

describe('nextDueDate (quarterly)', () => {
  it('returns the soonest anchored quarter on/after the date', () => {
    // anchor Jan → Jan/Apr/Jul/Oct; next after 2026-06-10 is Jul 15
    const due = nextDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-15')
  })

  it('rolls into next year past the last quarter', () => {
    const due = nextDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-10-20'))
    expect(due?.toISOString().slice(0, 10)).toBe('2027-01-15')
  })
})

describe('mostRecentDueDate', () => {
  it('monthly: the due_day this month when already passed', () => {
    const due = mostRecentDueDate(bill({ frequency: 'monthly', due_day: 1 }), d('2026-06-15'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-01')
  })

  it('monthly: last month when the due_day is still ahead', () => {
    const due = mostRecentDueDate(bill({ frequency: 'monthly', due_day: 20 }), d('2026-06-15'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-05-20')
  })

  it('weekly: the most recent occurrence of the weekday', () => {
    // 2026-06-10 is Wednesday (3); most recent Friday (5) is 2026-06-05
    const due = mostRecentDueDate(bill({ frequency: 'weekly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-05')
  })

  it('quarterly: the most recent anchored quarter', () => {
    const due = mostRecentDueDate(bill({ frequency: 'quarterly', due_month: 1, due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-04-15')
  })
})

describe('isPaid', () => {
  it('is paid when last_paid_date is in the current cycle', () => {
    const b = bill({ frequency: 'monthly', due_day: 1, last_paid_date: '2026-06-03' })
    expect(isPaid(b, d('2026-06-15'))).toBe(true)
  })

  it('auto-resets to unpaid once the next cycle begins', () => {
    const b = bill({ frequency: 'monthly', due_day: 1, last_paid_date: '2026-06-03' })
    expect(isPaid(b, d('2026-07-02'))).toBe(false)
  })

  it('is unpaid when last_paid_date is null', () => {
    expect(isPaid(bill({ last_paid_date: null }), d('2026-06-15'))).toBe(false)
  })
})

describe('monthlyCost', () => {
  it('normalizes each frequency to a monthly figure', () => {
    expect(monthlyCost(bill({ frequency: 'weekly', amount: 60 }))).toBe(260)
    expect(monthlyCost(bill({ frequency: 'monthly', amount: 1200 }))).toBe(1200)
    expect(monthlyCost(bill({ frequency: 'quarterly', amount: 300 }))).toBe(100)
    expect(monthlyCost(bill({ frequency: 'yearly', amount: 1200 }))).toBe(100)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: FAIL — `mostRecentDueDate`/`isPaid`/`monthlyCost` are not exported, and the new quarterly/yearly cases fail (currently return `null`).

- [ ] **Step 3: Implement**

Replace the ENTIRE contents of `finance-tracker/web/lib/finance/bill.ts` with:

```ts
import type { Bill } from '@/lib/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Midnight-UTC copy of a date (strips any time component). */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** A due date in the given year/month (0-based; overflow normalizes), clamping the day to the month length. */
function dueOn(year: number, month0: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month0, Math.min(day, lastDay)))
}

/**
 * The next date a bill is due on or after `from`.
 * - weekly:    `due_day` is day-of-week (Sun=0 … Sat=6)
 * - monthly:   `due_day` is day-of-month (1–31, clamped)
 * - yearly:    `due_month`/`due_day`, this year if ahead else next year
 * - quarterly: every 3 months anchored at `due_month`, soonest occurrence on/after `from`
 * Returns null only when a quarterly/yearly bill is missing its `due_month`.
 */
export function nextDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  if (bill.frequency === 'weekly') {
    const delta = (bill.due_day - today.getUTCDay() + 7) % 7
    return new Date(today.getTime() + delta * MS_PER_DAY)
  }

  if (bill.frequency === 'monthly') {
    const candidate = dueOn(y, m, bill.due_day)
    return candidate >= today ? candidate : dueOn(y, m + 1, bill.due_day)
  }

  if (bill.frequency === 'yearly') {
    if (bill.due_month == null) return null
    const candidate = dueOn(y, bill.due_month - 1, bill.due_day)
    return candidate >= today ? candidate : dueOn(y + 1, bill.due_month - 1, bill.due_day)
  }

  // quarterly: start a year back (guaranteed before `from`), step +3 months until on/after today
  if (bill.due_month == null) return null
  const anchor0 = bill.due_month - 1
  let k = 0
  let candidate = dueOn(y - 1, anchor0, bill.due_day)
  while (candidate < today) {
    k += 1
    candidate = dueOn(y - 1, anchor0 + 3 * k, bill.due_day)
  }
  return candidate
}

/** The latest date a bill was due on or before `from` (current cycle's start). */
export function mostRecentDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()

  if (bill.frequency === 'weekly') {
    const delta = (today.getUTCDay() - bill.due_day + 7) % 7
    return new Date(today.getTime() - delta * MS_PER_DAY)
  }

  if (bill.frequency === 'monthly') {
    const candidate = dueOn(y, m, bill.due_day)
    return candidate <= today ? candidate : dueOn(y, m - 1, bill.due_day)
  }

  if (bill.frequency === 'yearly') {
    if (bill.due_month == null) return null
    const candidate = dueOn(y, bill.due_month - 1, bill.due_day)
    return candidate <= today ? candidate : dueOn(y - 1, bill.due_month - 1, bill.due_day)
  }

  // quarterly: step forward from a year back, keeping the last occurrence on/before today
  if (bill.due_month == null) return null
  const anchor0 = bill.due_month - 1
  let k = 0
  let result = dueOn(y - 1, anchor0, bill.due_day)
  while (true) {
    k += 1
    const next = dueOn(y - 1, anchor0 + 3 * k, bill.due_day)
    if (next > today) break
    result = next
  }
  return result
}

/** Whole days from `from` until the bill's next due date, or null if undefined. */
export function daysUntilDue(bill: Bill, from: Date): number | null {
  const due = nextDueDate(bill, from)
  if (!due) return null
  return Math.round((due.getTime() - atUtcMidnight(from).getTime()) / MS_PER_DAY)
}

/** Whether the bill is paid for its current billing cycle (auto-resets each cycle). */
export function isPaid(bill: Bill, from: Date): boolean {
  if (!bill.last_paid_date) return false
  const cycleStart = mostRecentDueDate(bill, from)
  if (!cycleStart) return false
  const paid = new Date(`${bill.last_paid_date}T00:00:00Z`)
  return paid >= cycleStart
}

/** Normalized monthly-equivalent cost of the bill. */
export function monthlyCost(bill: Bill): number {
  if (bill.frequency === 'weekly') return (bill.amount * 52) / 12
  if (bill.frequency === 'monthly') return bill.amount
  if (bill.frequency === 'quarterly') return bill.amount / 3
  return bill.amount / 12 // yearly
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: PASS (existing weekly/monthly/daysUntilDue + all new blocks).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/bill.ts finance-tracker/web/lib/finance/bill.test.ts
git commit -m "feat(web): extend bill helpers — quarterly/yearly due dates, isPaid, monthlyCost"
```

---

### Task 3: Bills Server Actions (TDD)

**Files:**
- Create: `finance-tracker/web/app/(app)/bills/actions.ts`
- Test: `finance-tracker/web/app/(app)/bills/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/(app)/bills/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveBill, setBillPaid, deleteBill } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

const valid = {
  name: 'Rent',
  amount: '1200',
  category: 'Bills & Utilities',
  frequency: 'monthly',
  due_day: '1',
}

describe('saveBill', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    expect((await saveBill({}, fd(valid))).error).toBeTruthy()
  })

  it('rejects empty name, non-positive amount, and non-spending category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveBill({}, fd({ ...valid, name: '' }))).error).toBeTruthy()
    expect((await saveBill({}, fd({ ...valid, amount: '0' }))).error).toBeTruthy()
    expect((await saveBill({}, fd({ ...valid, category: 'Income' }))).error).toBeTruthy()
  })

  it('rejects quarterly/yearly without a due_month', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveBill({}, fd({ ...valid, frequency: 'quarterly', due_day: '15' }))).error).toBeTruthy()
  })

  it('inserts on create with due_month null for monthly', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await saveBill({}, fd(valid))
    expect(res.success).toBe(true)
    expect(bills.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', name: 'Rent', frequency: 'monthly', amount: 1200, due_month: null }),
    )
  })

  it('inserts quarterly with the chosen due_month', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await saveBill({}, fd({ ...valid, frequency: 'quarterly', due_day: '15', due_month: '1' }))
    expect(res.success).toBe(true)
    expect(bills.insert).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'quarterly', due_month: 1 }))
  })

  it('updates on edit (id present)', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await saveBill({}, fd({ ...valid, id }))
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rent' }))
    expect(bills.eq).toHaveBeenCalledWith('id', id)
    expect(bills.insert).not.toHaveBeenCalled()
  })
})

describe('setBillPaid', () => {
  it('sets last_paid_date to a date string when paying', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await setBillPaid('bill-1', true)
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith({ last_paid_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(bills.eq).toHaveBeenCalledWith('id', 'bill-1')
  })

  it('clears last_paid_date when un-paying', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await setBillPaid('bill-1', false)
    expect(res.success).toBe(true)
    expect(bills.update).toHaveBeenCalledWith({ last_paid_date: null })
  })
})

describe('deleteBill', () => {
  it('deletes by id', async () => {
    const bills = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { bills } }) as never)
    const res = await deleteBill('bill-9')
    expect(res.success).toBe(true)
    expect(bills.delete).toHaveBeenCalled()
    expect(bills.eq).toHaveBeenCalledWith('id', 'bill-9')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(app)/bills/actions.test.ts"`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/(app)/bills/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isSpendingCategory } from '@/lib/finance/categories'

export type ActionState = { error?: string; success?: boolean }

const billSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Please enter a name'),
    amount: z.coerce.number().positive('Amount must be greater than 0'),
    category: z.string().refine(isSpendingCategory, 'Please choose a spending category'),
    frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
    due_day: z.coerce.number().int('Day must be a whole number'),
    due_month: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      z.coerce.number().int().min(1).max(12).optional(),
    ),
  })
  .superRefine((val, ctx) => {
    const min = val.frequency === 'weekly' ? 0 : 1
    const max = val.frequency === 'weekly' ? 6 : 31
    if (val.due_day < min || val.due_day > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_day'], message: 'Invalid due day for this frequency' })
    }
    if ((val.frequency === 'quarterly' || val.frequency === 'yearly') && val.due_month == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['due_month'], message: 'Please choose a month' })
    }
  })

export async function saveBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = billSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, name, amount, category, frequency, due_day, due_month } = parsed.data
  const anchored = frequency === 'quarterly' || frequency === 'yearly'
  const row = {
    name,
    amount,
    category,
    frequency,
    due_day,
    due_month: anchored ? due_month : null,
  }

  const { error } = id
    ? await supabase.from('bills').update(row).eq('id', id)
    : await supabase.from('bills').insert({ user_id: user.id, ...row })

  if (error) return { error: 'Could not save the bill.' }
  revalidatePath('/bills')
  return { success: true }
}

export async function setBillPaid(id: string, paid: boolean): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const last_paid_date = paid ? new Date().toISOString().slice(0, 10) : null
  const { error } = await supabase.from('bills').update({ last_paid_date }).eq('id', id)
  if (error) return { error: 'Could not update the bill.' }
  revalidatePath('/bills')
  return { success: true }
}

export async function deleteBill(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('bills').delete().eq('id', id)
  if (error) return { error: 'Could not delete the bill.' }
  revalidatePath('/bills')
  return { success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/(app)/bills/actions.test.ts"`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/app/(app)/bills/actions.ts" "finance-tracker/web/app/(app)/bills/actions.test.ts"
git commit -m "feat(web): add bills server actions (save/mark-paid/delete)"
```

---

### Task 4: Bills UI — form, view, and page

Create files in dependency order (form → view → page) so each commit compiles. Build, then make TWO commits.

**Files:**
- Create: `finance-tracker/web/components/bills/bill-form.tsx`
- Create: `finance-tracker/web/components/bills/bills-view.tsx`
- Modify: `finance-tracker/web/app/(app)/bills/page.tsx` (replace the placeholder)

- [ ] **Step 1: Create the bill form**

Create `finance-tracker/web/components/bills/bill-form.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { saveBill, deleteBill, type ActionState } from '@/app/(app)/bills/actions'
import type { Bill } from '@/lib/types'

const initial: ActionState = {}
const fieldClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function BillForm({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveBill, initial)
  const [frequency, setFrequency] = useState<string>(bill?.frequency ?? 'monthly')

  useEffect(() => {
    if (state.success) {
      toast.success('Bill saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const b = bill
  const isWeekly = frequency === 'weekly'
  const needsMonth = frequency === 'quarterly' || frequency === 'yearly'

  async function handleDelete() {
    if (!b) return
    const res = await deleteBill(b.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Bill deleted')
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
        <h2 className="text-lg font-semibold">{b ? 'Edit bill' : 'Add bill'}</h2>
        <form action={formAction} className="space-y-3">
          {b && <input type="hidden" name="id" value={b.id} />}

          <div>
            <label className="text-sm">Name</label>
            <Input name="name" defaultValue={b?.name ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Amount</label>
            <Input name="amount" type="number" step="0.01" min="0" defaultValue={b?.amount ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Category</label>
            <select name="category" className={fieldClass} defaultValue={b?.category ?? SPENDING_CATEGORIES[0]} required>
              {SPENDING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm">Frequency</label>
            <select
              name="frequency"
              className={fieldClass}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          {needsMonth && (
            <div>
              <label className="text-sm">Month</label>
              <select name="due_month" className={fieldClass} defaultValue={b?.due_month ?? 1} required>
                {MONTHS.map((mn, i) => (
                  <option key={mn} value={i + 1}>
                    {mn}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-sm">{isWeekly ? 'Day of week' : 'Day of month'}</label>
            {isWeekly ? (
              <select name="due_day" className={fieldClass} defaultValue={b?.due_day ?? 1} required>
                {WEEKDAYS.map((wd, i) => (
                  <option key={wd} value={i}>
                    {wd}
                  </option>
                ))}
              </select>
            ) : (
              <Input name="due_day" type="number" min="1" max="31" defaultValue={b?.due_day ?? 1} required />
            )}
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

- [ ] **Step 2: Create the bills view**

Create `finance-tracker/web/components/bills/bills-view.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { nextDueDate, daysUntilDue, isPaid, monthlyCost } from '@/lib/finance/bill'
import { setBillPaid } from '@/app/(app)/bills/actions'
import { BillForm } from './bill-form'
import type { Bill } from '@/lib/types'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function dueLabel(days: number | null): string {
  if (days == null) return ''
  if (days === 0) return 'due today'
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`
  return `due in ${days} day${days === 1 ? '' : 's'}`
}

export function BillsView({ bills }: { bills: Bill[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<Bill | null>(null)
  const [creating, setCreating] = useState(false)
  const now = new Date()

  const sorted = [...bills].sort((a, b) => {
    const da = daysUntilDue(a, now)
    const db = daysUntilDue(b, now)
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })
  const totalMonthly = bills.reduce((sum, b) => sum + monthlyCost(b), 0)

  async function togglePaid(bill: Bill, paid: boolean) {
    const res = await setBillPaid(bill.id, !paid)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success(!paid ? 'Marked paid' : 'Marked unpaid')
      router.refresh()
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bills</h1>
        <Button onClick={() => setCreating(true)}>+ Add bill</Button>
      </div>

      {bills.length === 0 ? (
        <EmptyState title="No bills yet" hint="Add a recurring bill to see what's due and when." />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            ≈ {usd(totalMonthly)}/mo across {bills.length} bill{bills.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-2">
            {sorted.map((b) => {
              const due = nextDueDate(b, now)
              const days = daysUntilDue(b, now)
              const paid = isPaid(b, now)
              return (
                <Card key={b.id} className="space-y-2 p-4">
                  <div className="flex items-center justify-between">
                    <button type="button" className="text-left" onClick={() => setEditing(b)}>
                      <span className="font-medium">{b.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{b.category}</span>
                    </button>
                    <span className="text-sm text-muted-foreground">
                      {usd(b.amount)} · {b.frequency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      {due ? `Next: ${fmtDate(due)} · ${dueLabel(days)}` : 'No upcoming date'}
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {paid ? 'Paid' : 'Due'}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => togglePaid(b, paid)}>
                        {paid ? 'Mark unpaid' : 'Mark paid'}
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}

      {(creating || editing) && (
        <BillForm
          bill={editing}
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

Replace the ENTIRE contents of `finance-tracker/web/app/(app)/bills/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import { BillsView } from '@/components/bills/bills-view'
import type { Bill } from '@/lib/types'

export default async function BillsPage() {
  const supabase = await createClient()
  const { data: bills } = await supabase.from('bills').select('*').order('name')

  return <BillsView bills={(bills ?? []) as Bill[]} />
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds; route list includes `/bills`. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit (two commits, both compile)**

```bash
git add finance-tracker/web/components/bills/bill-form.tsx
git commit -m "feat(web): add bill add/edit/delete dialog"
git add "finance-tracker/web/app/(app)/bills/page.tsx" finance-tracker/web/components/bills/bills-view.tsx
git commit -m "feat(web): add bills page with due dates, paid status, and monthly summary"
```

---

### Task 5: Full verification & docs

**Files:**
- Modify: `CLAUDE.md` (local only — root `.gitignore` excludes it; not committed)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — extended bill helpers, bills actions, and all prior suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds; route list includes `/bills`; `npx tsc --noEmit` clean.

- [ ] **Step 3: Manual smoke test (requires the running app)**

Performed by the human operator with the dev server running (`npm run dev`):
1. Apply `finance-tracker/web/supabase/migrations/0004_bills_scheduling.sql` in the Supabase SQL editor. Confirm `bills` has `due_month` + `last_paid_date` and no `is_paid`.
2. Go to `/bills` → empty state. Click **+ Add bill** → add a **monthly** bill (e.g. Rent $1200, category Bills & Utilities, day of month 1). The card shows the next due date + "due in N days" and a **Due** badge.
3. Click **Mark paid** → badge flips to **Paid**. (It will auto-flip back to Due after the next due date passes.)
4. Add a **yearly** bill (pick a month + day) → the next due date is computed for this/next year. Add a **quarterly** bill (anchor month + day) → next due is the soonest anchored quarter.
5. Add a **weekly** bill → the day field becomes a weekday picker; next due is the upcoming weekday.
6. Confirm the summary reads "≈ $X/mo across N bills" and cards are sorted soonest-due first. Edit a bill; delete a bill.

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", update the Plan 5 line:

```markdown
- Plan 5 — Feature pages (decomposed): 5a Transactions **complete**; 5b Budgets **complete**; 5c Goals **complete**; **5d Bills** (`2026-06-21-bills-page.md`) — **in progress** (recurring bills, all four frequencies, auto-resetting paid status, monthly-cost summary, CRUD). Remaining: 5e Dashboard + cashflow charts.
```

Under the "## Web App" feature notes, add:

```markdown
- Bills (5d): recurring bills (`/bills`), flat list sorted by soonest due. Migration `0004_bills_scheduling.sql` adds `due_month` (quarterly/yearly anchor) + `last_paid_date` and drops `is_paid`. Pure helpers in `lib/finance/bill.ts`: `nextDueDate`/`mostRecentDueDate` (all four frequencies, day-clamped), `daysUntilDue`, `isPaid` (auto-resets each cycle via `last_paid_date`), `monthlyCost` (normalized $/mo). Categories from `SPENDING_CATEGORIES`. `saveBill`/`setBillPaid`/`deleteBill` actions. Fixed-vs-variable rollups deferred to 5e (bills vs. transactions).
```

- [ ] **Step 5: Confirm tracked files committed**

`CLAUDE.md` is git-ignored, so nothing new to commit there. Confirm a clean tree:

```bash
git status
```

---

## Done criteria

- `npx vitest run` green (extended bill tests, bills actions, all prior suites).
- `npm run build` succeeds with `/bills` rendering bills sorted by due date.
- All four frequencies compute a correct next due date; paid status auto-resets each cycle.
- Summary shows normalized ≈ $/mo + bill count; categories from the shared spending list.
- Create/edit/delete and mark paid/unpaid work via the Server Actions.
- `is_paid` removed in favor of `last_paid_date`; `monthsToGoal`-style Plan 3 helpers (`nextDueDate`/`daysUntilDue`) preserved.
- No fixed/variable rollups, no transaction linking, no reminders — those are later.
```
