# Goals Page Implementation Plan (Plan 5c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/goals` page — standalone savings goals with manual progress (an "Add contribution" action), a preset icon + color, and an optional target date driving a monthly-pace hint, plus create/edit/delete.

**Architecture:** A Server Component fetches the user's goals (RLS-enforced) and passes them to a client view that computes progress/pace per goal with new pure helpers in `lib/finance/goal.ts`. Create/edit/delete/contribute are Zod-validated Server Actions. Icons/colors come from controlled preset lists (`lib/finance/goal-presets.ts`). UI reuses the 5a/5b patterns (Tailwind-overlay modals + existing Button/Card/Input). The `goals` table already exists, so there is **no migration**.

**Tech Stack:** Next.js 16 (App Router, Server Actions) · React 19 (`useActionState`) · TypeScript · Zod 4 · `@supabase/ssr` · Vitest.

**Design source:** `docs/superpowers/specs/2026-06-21-goals-page-design.md`

**Scope:** Plan 5c only. No contribution history, no account/transaction linking, no reminders/reordering (all deferred). No bills (5d) or dashboard/charts (5e). The `Goal` type in `lib/types.ts` is unchanged.

**Conventions:** All commands run from `finance-tracker/web/`. Next.js 16: Server Actions live in `'use server'` files; page is an async Server Component. All automated tests mock Supabase (reuse `lib/plaid/test-helpers`) and need no DB. **Manual step the engineer can't do:** the `/goals` smoke test against a running app (Task 5).

---

### Task 1: Goal presets (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/goal-presets.ts`
- Create: `finance-tracker/web/lib/finance/goal-presets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/goal-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GOAL_ICONS, GOAL_COLORS, isGoalIcon, isGoalColor } from './goal-presets'

describe('goal presets', () => {
  it('has 8 icons and 6 colors', () => {
    expect(GOAL_ICONS).toHaveLength(8)
    expect(GOAL_COLORS).toHaveLength(6)
  })

  it('isGoalIcon accepts members and rejects non-members', () => {
    expect(isGoalIcon(GOAL_ICONS[0])).toBe(true)
    expect(isGoalIcon('🦄')).toBe(false)
    expect(isGoalIcon(123)).toBe(false)
  })

  it('isGoalColor accepts members and rejects non-members', () => {
    expect(isGoalColor(GOAL_COLORS[0])).toBe(true)
    expect(isGoalColor('#000000')).toBe(false)
    expect(isGoalColor(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/goal-presets.test.ts`
Expected: FAIL — cannot find module `./goal-presets`.

- [ ] **Step 3: Implement**

Create `finance-tracker/web/lib/finance/goal-presets.ts`:

```ts
/** Preset icons a goal can use (controlled list, validated server-side). */
export const GOAL_ICONS = ['🏖️', '🚗', '🏠', '🛟', '🎓', '🎁', '💍', '💰'] as const
export type GoalIcon = (typeof GOAL_ICONS)[number]

/** Preset progress-bar colors (hex), validated server-side. */
export const GOAL_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#d97706', '#e11d48', '#475569'] as const
export type GoalColor = (typeof GOAL_COLORS)[number]

/** Type guard: is a value one of the preset icons? */
export function isGoalIcon(value: unknown): value is GoalIcon {
  return typeof value === 'string' && (GOAL_ICONS as readonly string[]).includes(value)
}

/** Type guard: is a value one of the preset colors? */
export function isGoalColor(value: unknown): value is GoalColor {
  return typeof value === 'string' && (GOAL_COLORS as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/goal-presets.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/goal-presets.ts finance-tracker/web/lib/finance/goal-presets.test.ts
git commit -m "feat(web): add goal icon/color presets"
```

---

### Task 2: Goal math helpers (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/goal.ts`
- Create: `finance-tracker/web/lib/finance/goal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/goal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { goalProgress, goalReached, monthlyPaceNeeded } from './goal'

describe('goalProgress', () => {
  it('is 0 at the start', () => {
    expect(goalProgress(0, 3000)).toBe(0)
  })

  it('is the percent partway', () => {
    expect(goalProgress(1500, 3000)).toBe(50)
  })

  it('is 100 at the target and caps overshoot at 100', () => {
    expect(goalProgress(3000, 3000)).toBe(100)
    expect(goalProgress(4000, 3000)).toBe(100)
  })

  it('returns 0 for a non-positive target', () => {
    expect(goalProgress(100, 0)).toBe(0)
    expect(goalProgress(100, -5)).toBe(0)
  })
})

describe('goalReached', () => {
  it('is true at or above the target', () => {
    expect(goalReached(3000, 3000)).toBe(true)
    expect(goalReached(3500, 3000)).toBe(true)
  })

  it('is false below the target or with a non-positive target', () => {
    expect(goalReached(2999, 3000)).toBe(false)
    expect(goalReached(5, 0)).toBe(false)
  })
})

describe('monthlyPaceNeeded', () => {
  it('returns null when there is no target date', () => {
    expect(monthlyPaceNeeded(0, 3000, null, '2026-06-21')).toBeNull()
  })

  it('returns null when the goal is already reached', () => {
    expect(monthlyPaceNeeded(3000, 3000, '2026-12-01', '2026-06-21')).toBeNull()
  })

  it('divides the remaining amount by whole months remaining', () => {
    expect(monthlyPaceNeeded(0, 3000, '2026-12-01', '2026-06-21')).toBe(500)
    expect(monthlyPaceNeeded(1200, 3000, '2026-09-01', '2026-06-21')).toBe(600)
  })

  it('treats a past target date as due now (full remaining)', () => {
    expect(monthlyPaceNeeded(0, 3000, '2026-01-01', '2026-06-21')).toBe(3000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/goal.test.ts`
Expected: FAIL — cannot find module `./goal`.

- [ ] **Step 3: Implement**

Create `finance-tracker/web/lib/finance/goal.ts`:

```ts
/** Progress toward a goal as a percent 0–100 (overshoot caps at 100). */
export function goalProgress(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(100, (current / target) * 100)
}

/** True once the goal is funded (target must be positive). */
export function goalReached(current: number, target: number): boolean {
  return target > 0 && current >= target
}

/** Whole calendar months from `today` to `targetDate` (both 'YYYY-MM-DD'), min 1. */
function monthsUntil(today: string, targetDate: string): number {
  const [ty, tm] = today.split('-').map(Number)
  const [gy, gm] = targetDate.split('-').map(Number)
  const diff = (gy * 12 + (gm - 1)) - (ty * 12 + (tm - 1))
  return Math.max(1, diff)
}

/**
 * Amount to save per month to reach the target by `targetDate`.
 * Returns null when there is no date or the goal is already reached.
 * A past date is treated as "due now" (1 month), yielding the full remaining amount.
 */
export function monthlyPaceNeeded(
  current: number,
  target: number,
  targetDate: string | null,
  today: string,
): number | null {
  if (!targetDate) return null
  if (goalReached(current, target)) return null
  const remaining = target - current
  return remaining / monthsUntil(today, targetDate)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/goal.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/goal.ts finance-tracker/web/lib/finance/goal.test.ts
git commit -m "feat(web): add goal progress/pace helpers"
```

---

### Task 3: Goals Server Actions (TDD)

**Files:**
- Create: `finance-tracker/web/app/(app)/goals/actions.ts`
- Test: `finance-tracker/web/app/(app)/goals/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/(app)/goals/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { saveGoal, addContribution, deleteGoal } from './actions'
import { createClient } from '@/lib/supabase/server'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'
import { GOAL_ICONS, GOAL_COLORS } from '@/lib/finance/goal-presets'

const mockedCreateClient = vi.mocked(createClient)

beforeEach(() => vi.clearAllMocks())

function fd(obj: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(obj)) f.set(k, v)
  return f
}

const valid = {
  name: 'Vacation',
  target_amount: '3000',
  current_amount: '0',
  icon: GOAL_ICONS[0],
  color_hex: GOAL_COLORS[0],
}

describe('saveGoal', () => {
  it('errors when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await saveGoal({}, fd(valid))
    expect(res.error).toBeTruthy()
  })

  it('rejects an empty name', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveGoal({}, fd({ ...valid, name: '' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects a non-positive target', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveGoal({}, fd({ ...valid, target_amount: '0' }))
    expect(res.error).toBeTruthy()
  })

  it('rejects an invalid icon or color', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    expect((await saveGoal({}, fd({ ...valid, icon: '🦄' }))).error).toBeTruthy()
    expect((await saveGoal({}, fd({ ...valid, color_hex: '#000000' }))).error).toBeTruthy()
  })

  it('inserts on create (no id)', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await saveGoal({}, fd(valid))
    expect(res.success).toBe(true)
    expect(goals.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', name: 'Vacation', target_amount: 3000 }),
    )
    expect(goals.update).not.toHaveBeenCalled()
  })

  it('updates on edit (id present)', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const id = '11111111-1111-1111-1111-111111111111'
    const res = await saveGoal({}, fd({ ...valid, id }))
    expect(res.success).toBe(true)
    expect(goals.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Vacation', target_amount: 3000 }),
    )
    expect(goals.eq).toHaveBeenCalledWith('id', id)
    expect(goals.insert).not.toHaveBeenCalled()
  })
})

describe('addContribution', () => {
  it('rejects a non-positive amount', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await addContribution('goal-1', 0)
    expect(res.error).toBeTruthy()
  })

  it('adds the amount to the current total', async () => {
    const goals = createQueryStub({ data: { current_amount: 100 }, error: null })
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await addContribution('goal-1', 500)
    expect(res.success).toBe(true)
    expect(goals.update).toHaveBeenCalledWith({ current_amount: 600 })
    expect(goals.eq).toHaveBeenCalledWith('id', 'goal-1')
  })
})

describe('deleteGoal', () => {
  it('deletes by id', async () => {
    const goals = createQueryStub()
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { goals } }) as never)
    const res = await deleteGoal('goal-9')
    expect(res.success).toBe(true)
    expect(goals.delete).toHaveBeenCalled()
    expect(goals.eq).toHaveBeenCalledWith('id', 'goal-9')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(app)/goals/actions.test.ts"`
Expected: FAIL — cannot find module `./actions`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/(app)/goals/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isGoalIcon, isGoalColor } from '@/lib/finance/goal-presets'

export type ActionState = { error?: string; success?: boolean }

const goalSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Please enter a name'),
  target_amount: z.coerce.number().positive('Target must be greater than 0'),
  current_amount: z.coerce.number().min(0, 'Current amount cannot be negative'),
  target_date: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  icon: z.string().refine(isGoalIcon, 'Please choose an icon'),
  color_hex: z.string().refine(isGoalColor, 'Please choose a color'),
})

export async function saveGoal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = goalSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const { id, name, target_amount, current_amount, target_date, icon, color_hex } = parsed.data
  const row = { name, target_amount, current_amount, target_date, icon, color_hex }

  const { error } = id
    ? await supabase.from('goals').update(row).eq('id', id)
    : await supabase.from('goals').insert({ user_id: user.id, ...row })

  if (error) return { error: 'Could not save the goal.' }
  revalidatePath('/goals')
  return { success: true }
}

export async function addContribution(id: string, amount: number): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  if (!(amount > 0)) return { error: 'Contribution must be greater than 0.' }

  const { data: goal, error: readErr } = await supabase
    .from('goals')
    .select('current_amount')
    .eq('id', id)
    .single()
  if (readErr || !goal) return { error: 'Could not find the goal.' }

  const { error } = await supabase
    .from('goals')
    .update({ current_amount: Number(goal.current_amount) + amount })
    .eq('id', id)
  if (error) return { error: 'Could not add the contribution.' }
  revalidatePath('/goals')
  return { success: true }
}

export async function deleteGoal(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) return { error: 'Could not delete the goal.' }
  revalidatePath('/goals')
  return { success: true }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/(app)/goals/actions.test.ts"`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add "finance-tracker/web/app/(app)/goals/actions.ts" "finance-tracker/web/app/(app)/goals/actions.test.ts"
git commit -m "feat(web): add goals server actions (save/contribute/delete)"
```

---

### Task 4: Goals UI — forms, view, and page

Create the files in dependency order (forms → view → page) so every commit compiles. Build, then make TWO commits.

**Files:**
- Create: `finance-tracker/web/components/goals/goal-form.tsx`
- Create: `finance-tracker/web/components/goals/contribution-form.tsx`
- Create: `finance-tracker/web/components/goals/goals-view.tsx`
- Modify: `finance-tracker/web/app/(app)/goals/page.tsx` (replace the placeholder)

- [ ] **Step 1: Create the goal form**

Create `finance-tracker/web/components/goals/goal-form.tsx`:

```tsx
'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { GOAL_ICONS, GOAL_COLORS } from '@/lib/finance/goal-presets'
import { saveGoal, deleteGoal, type ActionState } from '@/app/(app)/goals/actions'
import type { Goal } from '@/lib/types'

const initial: ActionState = {}

export function GoalForm({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveGoal, initial)
  const [icon, setIcon] = useState<string>(goal?.icon ?? GOAL_ICONS[0])
  const [color, setColor] = useState<string>(goal?.color_hex ?? GOAL_COLORS[0])

  useEffect(() => {
    if (state.success) {
      toast.success('Goal saved')
      router.refresh()
      onClose()
    } else if (state.error) {
      toast.error(state.error)
    }
  }, [state, onClose, router])

  const g = goal

  async function handleDelete() {
    if (!g) return
    const res = await deleteGoal(g.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Goal deleted')
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
        <h2 className="text-lg font-semibold">{g ? 'Edit goal' : 'Add goal'}</h2>
        <form action={formAction} className="space-y-3">
          {g && <input type="hidden" name="id" value={g.id} />}
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="color_hex" value={color} />

          <div>
            <label className="text-sm">Name</label>
            <Input name="name" defaultValue={g?.name ?? ''} required />
          </div>
          <div>
            <label className="text-sm">Target amount</label>
            <Input
              name="target_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={g?.target_amount ?? ''}
              required
            />
          </div>
          <div>
            <label className="text-sm">Current amount</label>
            <Input
              name="current_amount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={g?.current_amount ?? 0}
            />
          </div>
          <div>
            <label className="text-sm">Target date (optional)</label>
            <Input name="target_date" type="date" defaultValue={g?.target_date ?? ''} />
          </div>

          <div>
            <label className="text-sm">Icon</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_ICONS.map((ic) => (
                <button
                  type="button"
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className={`h-9 w-9 rounded-md border text-lg ${
                    icon === ic ? 'border-foreground' : 'border-input'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm">Color</label>
            <div className="flex flex-wrap gap-2">
              {GOAL_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={c}
                  className={`h-7 w-7 rounded-full border-2 ${
                    color === c ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {state.error && (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2">
            {g ? (
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

- [ ] **Step 2: Create the contribution form**

Create `finance-tracker/web/components/goals/contribution-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { addContribution } from '@/app/(app)/goals/actions'
import type { Goal } from '@/lib/types'

export function ContributionForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSave() {
    const n = Number(amount)
    if (!(n > 0)) {
      toast.error('Enter an amount greater than 0.')
      return
    }
    setPending(true)
    const res = await addContribution(goal.id, n)
    setPending(false)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Contribution added')
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
        <h2 className="text-lg font-semibold">Add to {goal.name}</h2>
        <div>
          <label className="text-sm">Amount</label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Create the goals view**

Create `finance-tracker/web/components/goals/goals-view.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/empty-state'
import { goalProgress, goalReached, monthlyPaceNeeded } from '@/lib/finance/goal'
import { GoalForm } from './goal-form'
import { ContributionForm } from './contribution-form'
import type { Goal } from '@/lib/types'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function todayIso(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

export function GoalsView({ goals }: { goals: Goal[] }) {
  const [editing, setEditing] = useState<Goal | null>(null)
  const [creating, setCreating] = useState(false)
  const [contributing, setContributing] = useState<Goal | null>(null)
  const today = todayIso()

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Goals</h1>
        <Button onClick={() => setCreating(true)}>+ Add goal</Button>
      </div>

      {goals.length === 0 ? (
        <EmptyState title="No goals yet" hint="Set a savings goal and track your progress." />
      ) : (
        <div className="space-y-2">
          {goals.map((g) => {
            const pct = goalProgress(g.current_amount, g.target_amount)
            const reached = goalReached(g.current_amount, g.target_amount)
            const pace = monthlyPaceNeeded(g.current_amount, g.target_amount, g.target_date ?? null, today)
            const remaining = g.target_amount - g.current_amount
            return (
              <Card key={g.id} className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setEditing(g)}
                  >
                    <span className="text-lg" aria-hidden>
                      {g.icon}
                    </span>
                    <span className="font-medium">{g.name}</span>
                  </button>
                  <span className="text-sm text-muted-foreground">
                    {usd(g.current_amount)} of {usd(g.target_amount)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full" style={{ width: `${pct}%`, backgroundColor: g.color_hex }} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {reached
                      ? 'Reached 🎉'
                      : pace != null
                        ? `Save ~${usd(pace)}/mo to reach by ${g.target_date}`
                        : `${usd(remaining)} to go`}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setContributing(g)}>
                    Add contribution
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <GoalForm
          goal={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
      {contributing && (
        <ContributionForm goal={contributing} onClose={() => setContributing(null)} />
      )}
    </section>
  )
}
```

- [ ] **Step 4: Replace the placeholder page**

Replace the ENTIRE contents of `finance-tracker/web/app/(app)/goals/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import { GoalsView } from '@/components/goals/goals-view'
import type { Goal } from '@/lib/types'

export default async function GoalsPage() {
  const supabase = await createClient()
  const { data: goals } = await supabase.from('goals').select('*').order('name')

  return <GoalsView goals={(goals ?? []) as Goal[]} />
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: build succeeds; route list includes `/goals`. `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit (two commits, both compile)**

```bash
git add finance-tracker/web/components/goals/goal-form.tsx finance-tracker/web/components/goals/contribution-form.tsx
git commit -m "feat(web): add goal add/edit/delete and contribution dialogs"
git add "finance-tracker/web/app/(app)/goals/page.tsx" finance-tracker/web/components/goals/goals-view.tsx
git commit -m "feat(web): add goals page with progress bars and pace hints"
```

---

### Task 5: Full verification & docs

**Files:**
- Modify: `CLAUDE.md` (local only — root `.gitignore` excludes it; not committed)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — goal presets, goal helpers, goals actions, and all prior suites.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: succeeds; route list includes `/goals`; `npx tsc --noEmit` clean.

- [ ] **Step 3: Manual smoke test (requires the running app)**

Performed by the human operator with the dev server running (`npm run dev`):
1. Go to `/goals` → empty state. Click **+ Add goal** → fill name "Vacation", target 3000, current 0, a target date a few months out, pick the 🏖️ icon and the blue swatch. Save.
2. The card shows a 0% bar tinted blue, "$0.00 of $3,000.00", and a pace hint "Save ~$X/mo to reach by <date>".
3. Click **Add contribution** → enter 500 → the bar fills to ~17%, the total reads $500.00, and the pace hint recomputes.
4. Click the card (name/icon) → edit the target or current; **Delete** removes the goal.
5. Add a goal with no target date → its line reads "$X to go" (no pace hint).
6. Fund a goal to/over its target → the line reads "Reached 🎉" and the bar is full.

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", update the Plan 5 line to mark 5b complete and 5c in progress:

```markdown
- Plan 5 — Feature pages (decomposed): 5a Transactions **complete**; 5b Budgets **complete**; **5c Goals** (`2026-06-21-goals-page.md`) — **in progress** (standalone savings goals, manual contributions, preset icon/color, optional target-date pace hint, CRUD). Remaining: 5d Bills, 5e Dashboard + cashflow charts.
```

Under the "## Web App" section's feature notes, add:

```markdown
- Goals (5c): standalone savings goals (no month scope). `/goals` lists goal cards with a progress bar tinted by the goal's preset `color_hex`; progress is manual via an "Add contribution" action (`addContribution` increments `current_amount`) plus direct edits. Icons/colors come from controlled `GOAL_ICONS`/`GOAL_COLORS` (`lib/finance/goal-presets.ts`); pure math (`goalProgress`/`goalReached`/`monthlyPaceNeeded`) lives in `lib/finance/goal.ts`. No contribution history, no account/transaction linking. The `goals` table pre-existed — no migration.
```

- [ ] **Step 5: Commit (the spec/plan are tracked; CLAUDE.md is not)**

There is nothing new to commit if only `CLAUDE.md` changed (it's git-ignored). Confirm with `git status`; if any tracked file changed, commit it:

```bash
git status
```

---

## Done criteria

- `npx vitest run` green (goal presets, goal helpers, goals actions, all prior suites).
- `npm run build` succeeds with `/goals` rendering goal cards.
- Manual progress works: "Add contribution" increments `current_amount`; edit sets values directly.
- Icon + color chosen from presets; progress bar tinted by the goal's color.
- Optional target date drives a monthly-pace hint; reached goals show "Reached 🎉".
- Create/edit/delete work via the Server Actions.
- No contribution history, no account/transaction linking, no bills/dashboard — those are later plans.
