# Recurring-Transaction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect recurring charges from transaction history, list them on `/bills`, and let the user promote a candidate to a tracked bill (prefilled form + merchant link) or dismiss it.

**Architecture:** A pure detector in `lib/finance/recurring.ts` groups trailing-13-month expenses by normalized merchant, classifies cadence into the four bill frequencies with regularity/amount guards, and emits `RecurringCandidate`s. A pure `matchCandidates` buckets them against bills (exact `merchant_name` link or fuzzy name fallback) and a new `recurring_dismissals` table. The `/bills` page fetches, detects, and passes `{open, dismissed}` to a new `DetectedRecurring` client component; "Track as bill" reuses `BillForm` via a new optional `prefill` prop. Detection is recomputed per page load — no stored results.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (`@supabase/ssr`) · Zod 4 · Vitest · Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-19-recurring-detection-design.md`

## Global Constraints

- **Next.js 16 conventions** — see `finance-tracker/web/AGENTS.md`; `cookies()` is async; verify APIs against `node_modules/next/dist/docs/` before writing code.
- **`lib/finance/` stays Supabase/React-free** — pure, unit-tested logic only.
- **Detection window:** trailing **13 months** from a `today: Date` parameter (never the clock inside the pure module).
- **Cadence bands (median interval in days → frequency):** weekly 5–9, monthly 28–33, quarterly 85–95, yearly 350–380. Occurrence floors: 3, except yearly = 2. A median outside every band (e.g. 14 days) → not a candidate.
- **Regularity guard:** every interval within ±20% of the median interval. **Amount guard:** every magnitude within ±30% of the median magnitude.
- **Input filtering in `detectRecurring`:** expenses only (`amount < 0`), `category !== 'Transfer'`, raw parent rows (never exploded), blank merchant keys skipped.
- **`merchant_name` identity is the normalized key** (`normalizeMerchant`): lowercase, collapse whitespace, strip one trailing digit run; stored normalized in `recurring_dismissals` and `bills.merchant_name`.
- **Money rounded to cents** (`Math.round(n * 100) / 100`).
- **Every action resolves the user from the session** (`supabase.auth.getUser()`), never from the request body.
- Follow the bills page's existing idiom: native `<select>`/inputs + the existing Tailwind modal, `Card` rows, sonner toasts, `router.refresh()` after actions.
- **Commands** (run from `finance-tracker/web`): `npx vitest run <file>` for one test file; `npx vitest run` for the suite; `npm run build` for the production build/typecheck.

---

### Task 1: Pure detection — `normalizeMerchant` + `detectRecurring` (+ `monthlyEquivalent` refactor)

**Files:**
- Create: `finance-tracker/web/lib/finance/recurring.ts`
- Modify: `finance-tracker/web/lib/finance/bill.ts` (extract `monthlyEquivalent`)
- Test: `finance-tracker/web/lib/finance/recurring.test.ts`
- Test (modify): `finance-tracker/web/lib/finance/bill.test.ts` (one added describe block)

**Interfaces:**
- Consumes: `Transaction`, `BillFrequency` from `@/lib/types`; `SPENDING_CATEGORIES` from `@/lib/finance/categories`.
- Produces (Tasks 2 and 4 rely on these exact signatures):
  - `interface RecurringCandidate { merchantKey: string; displayName: string; frequency: BillFrequency; amount: number; occurrences: number; lastDate: string; dueDayGuess: number; dueMonthGuess: number | null; categoryGuess: string }`
  - `normalizeMerchant(name: string): string`
  - `detectRecurring(transactions: Transaction[], today: Date): RecurringCandidate[]` (sorted by monthly-equivalent impact, descending)
  - `monthlyEquivalent(amount: number, frequency: BillFrequency): number` (from `bill.ts`; `monthlyCost` now delegates to it)

- [ ] **Step 1: Refactor `monthlyCost` to expose `monthlyEquivalent`**

In `finance-tracker/web/lib/finance/bill.ts`, change the import line to include `BillFrequency`:

```ts
import type { Bill, BillFrequency } from '@/lib/types'
```

Replace the existing `monthlyCost` function at the bottom of the file:

```ts
/** Normalized monthly-equivalent cost of the bill. */
export function monthlyCost(bill: Bill): number {
  if (bill.frequency === 'weekly') return (bill.amount * 52) / 12
  if (bill.frequency === 'monthly') return bill.amount
  if (bill.frequency === 'quarterly') return bill.amount / 3
  return bill.amount / 12 // yearly
}
```

with:

```ts
/** Normalized monthly-equivalent cost of an amount recurring at a frequency. */
export function monthlyEquivalent(amount: number, frequency: BillFrequency): number {
  if (frequency === 'weekly') return (amount * 52) / 12
  if (frequency === 'monthly') return amount
  if (frequency === 'quarterly') return amount / 3
  return amount / 12 // yearly
}

/** Normalized monthly-equivalent cost of the bill. */
export function monthlyCost(bill: Bill): number {
  return monthlyEquivalent(bill.amount, bill.frequency)
}
```

Append to `finance-tracker/web/lib/finance/bill.test.ts` (import `monthlyEquivalent` in the existing import from `./bill`):

```ts
describe('monthlyEquivalent', () => {
  it('normalizes each frequency to $/mo', () => {
    expect(monthlyEquivalent(12, 'weekly')).toBe(52)
    expect(monthlyEquivalent(100, 'monthly')).toBe(100)
    expect(monthlyEquivalent(300, 'quarterly')).toBe(100)
    expect(monthlyEquivalent(1200, 'yearly')).toBe(100)
  })
})
```

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: PASS (existing `monthlyCost` tests prove the delegation is behavior-preserving).

- [ ] **Step 2: Write the failing detection tests**

Create `finance-tracker/web/lib/finance/recurring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeMerchant, detectRecurring } from './recurring'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', account_id: null, amount: -15.49,
    date: '2026-07-01', merchant_name: 'Netflix.com', category: 'Entertainment',
    notes: null, is_manual: false, ...partial,
  }
}

const TODAY = new Date('2026-07-19T00:00:00Z')

/** One txn per date, ids unique, shared overrides. */
function series(dates: string[], over: Partial<Transaction> = {}): Transaction[] {
  return dates.map((d, i) => txn({ id: `t${i}`, date: d, ...over }))
}

describe('normalizeMerchant', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeMerchant('  Spotify   USA  ')).toBe('spotify usa')
  })

  it('strips a trailing digit run', () => {
    expect(normalizeMerchant('NETFLIX.COM 4029')).toBe('netflix.com')
  })

  it('keeps internal digits', () => {
    expect(normalizeMerchant('7-Eleven')).toBe('7-eleven')
  })

  it('returns empty for digit-only names', () => {
    expect(normalizeMerchant('12345')).toBe('')
  })
})

describe('detectRecurring — cadence classification', () => {
  it('detects a monthly charge', () => {
    const txns = series(['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'])
    const [c] = detectRecurring(txns, TODAY)
    expect(c).toMatchObject({
      merchantKey: 'netflix.com',
      frequency: 'monthly',
      amount: 15.49,
      occurrences: 5,
      lastDate: '2026-06-15',
      dueDayGuess: 15,
      dueMonthGuess: null,
      categoryGuess: 'Entertainment',
    })
  })

  it('detects a weekly charge with day-of-week dueDayGuess', () => {
    // 2026-06-05 is a Friday (day 5)
    const txns = series(['2026-05-22', '2026-05-29', '2026-06-05'], { merchant_name: 'GymPass' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('weekly')
    expect(c.dueDayGuess).toBe(5)
  })

  it('detects a quarterly charge with dueMonthGuess', () => {
    const txns = series(['2025-10-05', '2026-01-05', '2026-04-05'], { merchant_name: 'Water Utility' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('quarterly')
    expect(c.dueDayGuess).toBe(5)
    expect(c.dueMonthGuess).toBe(4)
  })

  it('detects a yearly charge from only two occurrences', () => {
    const txns = series(['2025-08-01', '2026-07-30'], { merchant_name: 'Domain Renewal' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.frequency).toBe('yearly')
    expect(c.occurrences).toBe(2)
    expect(c.dueMonthGuess).toBe(7)
  })
})

describe('detectRecurring — rejection guards', () => {
  it('rejects a 14-day cadence (not a bill frequency)', () => {
    const txns = series(['2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects erratic intervals (beyond ±20% of median)', () => {
    // intervals 31, 19, 42 — median 31, 19 and 42 both deviate > 6.2
    const txns = series(['2026-03-01', '2026-04-01', '2026-04-20', '2026-06-01'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects wildly varying amounts (beyond ±30% of median)', () => {
    const dates = ['2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10']
    const amounts = [-10, -50, -12, -11, -12]
    const txns = dates.map((d, i) => txn({ id: `t${i}`, date: d, amount: amounts[i] }))
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('rejects monthly cadence with fewer than 3 occurrences', () => {
    const txns = series(['2026-05-10', '2026-06-09'])
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })
})

describe('detectRecurring — input filtering', () => {
  it('ignores income, Transfer, blank merchants, and pre-window history', () => {
    const txns = [
      ...series(['2026-04-01', '2026-05-01', '2026-06-01'], { amount: 3000, category: 'Income' }),
      ...series(['2026-04-02', '2026-05-02', '2026-06-02'], { merchant_name: 'My Savings', category: 'Transfer' }),
      ...series(['2026-04-03', '2026-05-03', '2026-06-03'], { merchant_name: '99887' }),
      // window start is 2025-06-19; this series ended before it
      ...series(['2025-03-10', '2025-04-10', '2025-05-10'], { merchant_name: 'Old Gym' }),
    ]
    expect(detectRecurring(txns, TODAY)).toEqual([])
  })

  it('falls back to Uncategorized when the modal category is not a spending category', () => {
    const txns = series(['2026-04-15', '2026-05-15', '2026-06-15'], { category: 'Split' })
    const [c] = detectRecurring(txns, TODAY)
    expect(c.categoryGuess).toBe('Uncategorized')
  })

  it('sorts candidates by monthly-equivalent impact, descending', () => {
    const txns = [
      ...series(['2026-04-01', '2026-05-01', '2026-06-01'], { merchant_name: 'Cheap Sub', amount: -5 }),
      ...series(['2026-04-02', '2026-05-02', '2026-06-02'], { merchant_name: 'Big Rent', amount: -1500 }),
    ]
    const out = detectRecurring(txns, TODAY)
    expect(out.map((c) => c.merchantKey)).toEqual(['big rent', 'cheap sub'])
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/finance/recurring.test.ts`
Expected: FAIL — cannot resolve `./recurring`.

- [ ] **Step 4: Write the implementation**

Create `finance-tracker/web/lib/finance/recurring.ts`:

```ts
import type { BillFrequency, Transaction } from '@/lib/types'
import { SPENDING_CATEGORIES } from '@/lib/finance/categories'
import { monthlyEquivalent } from '@/lib/finance/bill'

/** A detected recurring charge, carrying everything needed to prefill a bill. */
export interface RecurringCandidate {
  merchantKey: string // normalized key — identity for matching and dismissal
  displayName: string // most recent raw merchant_name
  frequency: BillFrequency
  amount: number // median magnitude, rounded to cents
  occurrences: number
  lastDate: string // ISO 'YYYY-MM-DD' of the most recent occurrence
  dueDayGuess: number // weekly: day-of-week (Sun=0) of lastDate; others: day-of-month
  dueMonthGuess: number | null // month (1–12) of lastDate for quarterly/yearly; null otherwise
  categoryGuess: string // modal category, falling back to 'Uncategorized'
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WINDOW_MONTHS = 13

/** Median-interval band (days) → bill frequency, with its occurrence floor. */
const BANDS: { frequency: BillFrequency; min: number; max: number; minOccurrences: number }[] = [
  { frequency: 'weekly', min: 5, max: 9, minOccurrences: 3 },
  { frequency: 'monthly', min: 28, max: 33, minOccurrences: 3 },
  { frequency: 'quarterly', min: 85, max: 95, minOccurrences: 3 },
  { frequency: 'yearly', min: 350, max: 380, minOccurrences: 2 },
]

const toCents = (n: number) => Math.round(n * 100) / 100

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Lowercase, collapse whitespace, strip one trailing digit run ("NETFLIX.COM 4029" → "netflix.com"). */
export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s#*-]*\d+$/, '')
    .trim()
}

/**
 * Detects recurring charges in the trailing 13 months before `today`.
 * Expenses only, Transfer excluded, raw parent rows (splits are irrelevant —
 * detection is merchant-level). Sorted by monthly-equivalent impact, descending.
 */
export function detectRecurring(transactions: Transaction[], today: Date): RecurringCandidate[] {
  const start = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - WINDOW_MONTHS, today.getUTCDate()),
  )
  const startIso = start.toISOString().slice(0, 10)

  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (t.amount >= 0) continue
    if (t.category === 'Transfer') continue
    if (t.date < startIso) continue
    const key = normalizeMerchant(t.merchant_name)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(t)
    groups.set(key, list)
  }

  const out: RecurringCandidate[] = []
  for (const [key, txns] of groups) {
    const sorted = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1))
    if (sorted.length < 2) continue

    const days = sorted.map((t) => new Date(`${t.date}T00:00:00Z`).getTime() / MS_PER_DAY)
    const intervals: number[] = []
    for (let i = 1; i < days.length; i++) intervals.push(days[i] - days[i - 1])
    const med = median(intervals)

    const band = BANDS.find((b) => med >= b.min && med <= b.max)
    if (!band) continue
    if (sorted.length < band.minOccurrences) continue
    if (!intervals.every((iv) => Math.abs(iv - med) <= med * 0.2)) continue

    const magnitudes = sorted.map((t) => Math.abs(t.amount))
    const medAmount = median(magnitudes)
    if (!magnitudes.every((m) => Math.abs(m - medAmount) <= medAmount * 0.3)) continue

    const counts = new Map<string, number>()
    for (const t of sorted) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    let modal = 'Uncategorized'
    let best = 0
    for (const [category, n] of counts) {
      if (n > best) {
        best = n
        modal = category
      }
    }
    const categoryGuess = (SPENDING_CATEGORIES as readonly string[]).includes(modal)
      ? modal
      : 'Uncategorized'

    const last = sorted[sorted.length - 1]
    const lastD = new Date(`${last.date}T00:00:00Z`)
    out.push({
      merchantKey: key,
      displayName: last.merchant_name,
      frequency: band.frequency,
      amount: toCents(medAmount),
      occurrences: sorted.length,
      lastDate: last.date,
      dueDayGuess: band.frequency === 'weekly' ? lastD.getUTCDay() : lastD.getUTCDate(),
      dueMonthGuess:
        band.frequency === 'quarterly' || band.frequency === 'yearly'
          ? lastD.getUTCMonth() + 1
          : null,
      categoryGuess,
    })
  }

  return out.sort(
    (a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency),
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/finance/recurring.test.ts`
Expected: PASS (15 tests).

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: PASS (no regression from the refactor).

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/lib/finance/recurring.ts finance-tracker/web/lib/finance/recurring.test.ts finance-tracker/web/lib/finance/bill.ts finance-tracker/web/lib/finance/bill.test.ts
git commit -m "feat(web): add pure recurring-charge detection"
```

---

### Task 2: Pure matching — `matchCandidates` (+ `Bill.merchant_name` / `RecurringDismissal` types)

**Files:**
- Modify: `finance-tracker/web/lib/finance/recurring.ts` (append `matchCandidates`)
- Modify: `finance-tracker/web/lib/types.ts` (extend `Bill`, add `RecurringDismissal`)
- Test: `finance-tracker/web/lib/finance/recurring.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `RecurringCandidate`, `normalizeMerchant` (Task 1); `Bill` from `@/lib/types`.
- Produces (Task 4 relies on these):
  - `Bill` gains `merchant_name?: string | null`
  - `interface RecurringDismissal { id: string; user_id: string; merchant_name: string }`
  - `matchCandidates(candidates: RecurringCandidate[], bills: Bill[], dismissedKeys: string[]): { open: RecurringCandidate[]; dismissed: RecurringCandidate[] }` — tracked candidates appear in neither list.

- [ ] **Step 1: Extend the types**

In `finance-tracker/web/lib/types.ts`, add to the `Bill` interface (after `last_paid_date`):

```ts
  merchant_name?: string | null // normalized merchant key; set when promoted from a detected candidate
```

Add after the `Bill` interface:

```ts
export interface RecurringDismissal {
  id: string
  user_id: string
  merchant_name: string // normalized merchant key
}
```

- [ ] **Step 2: Write the failing tests**

Append to `finance-tracker/web/lib/finance/recurring.test.ts` (extend the import from `./recurring` with `matchCandidates`, add `import type { RecurringCandidate } from './recurring'`, and add `Bill` to the types import):

```ts
describe('matchCandidates', () => {
  function candidate(partial: Partial<RecurringCandidate>): RecurringCandidate {
    return {
      merchantKey: 'netflix.com', displayName: 'Netflix.com', frequency: 'monthly' as const,
      amount: 15.49, occurrences: 5, lastDate: '2026-06-15',
      dueDayGuess: 15, dueMonthGuess: null, categoryGuess: 'Entertainment',
      ...partial,
    }
  }
  function bill(partial: Partial<Bill>): Bill {
    return {
      id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
      due_day: 1, frequency: 'monthly', category: 'Bills & Utilities',
      due_month: null, last_paid_date: null, merchant_name: null, ...partial,
    }
  }

  it('excludes a candidate tracked via exact merchant link', () => {
    const { open, dismissed } = matchCandidates(
      [candidate({})], [bill({ merchant_name: 'netflix.com' })], [],
    )
    expect(open).toEqual([])
    expect(dismissed).toEqual([])
  })

  it('excludes a candidate tracked via fuzzy bill-name match', () => {
    const { open } = matchCandidates([candidate({})], [bill({ name: 'Netflix' })], [])
    expect(open).toEqual([])
  })

  it('buckets a dismissed candidate', () => {
    const { open, dismissed } = matchCandidates([candidate({})], [], ['netflix.com'])
    expect(open).toEqual([])
    expect(dismissed).toHaveLength(1)
  })

  it('tracked wins over dismissed', () => {
    const { open, dismissed } = matchCandidates(
      [candidate({})], [bill({ merchant_name: 'netflix.com' })], ['netflix.com'],
    )
    expect(open).toEqual([])
    expect(dismissed).toEqual([])
  })

  it('leaves unmatched candidates open', () => {
    const { open } = matchCandidates([candidate({})], [bill({})], [])
    expect(open).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/finance/recurring.test.ts`
Expected: FAIL — `matchCandidates` is not exported.

- [ ] **Step 4: Implement `matchCandidates`**

Append to `finance-tracker/web/lib/finance/recurring.ts` (add `Bill` to the types import at the top):

```ts
/**
 * Buckets candidates against tracked bills and dismissals. A candidate is
 * tracked when a bill's merchant_name equals its key (exact link, set on
 * promote) or a bill's normalized name fuzzy-matches (substring either way —
 * the fallback for pre-existing manual bills). Tracked > dismissed > open;
 * tracked candidates appear in neither returned list.
 */
export function matchCandidates(
  candidates: RecurringCandidate[],
  bills: Bill[],
  dismissedKeys: string[],
): { open: RecurringCandidate[]; dismissed: RecurringCandidate[] } {
  const dismissedSet = new Set(dismissedKeys)
  const open: RecurringCandidate[] = []
  const dismissed: RecurringCandidate[] = []
  for (const c of candidates) {
    const tracked = bills.some((b) => {
      if (b.merchant_name && normalizeMerchant(b.merchant_name) === c.merchantKey) return true
      const name = normalizeMerchant(b.name)
      return name.length > 0 && (c.merchantKey.includes(name) || name.includes(c.merchantKey))
    })
    if (tracked) continue
    if (dismissedSet.has(c.merchantKey)) dismissed.push(c)
    else open.push(c)
  }
  return { open, dismissed }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/finance/recurring.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/lib/finance/recurring.ts finance-tracker/web/lib/finance/recurring.test.ts finance-tracker/web/lib/types.ts
git commit -m "feat(web): match recurring candidates against bills and dismissals"
```

---

### Task 3: Schema + server actions — migration `0008`, dismiss/restore, `saveBill` merchant link

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0008_recurring_detection.sql`
- Modify: `finance-tracker/web/app/(app)/bills/actions.ts`

**Interfaces:**
- Consumes: existing `ActionState`, `billSchema`, `saveBill` in `bills/actions.ts`.
- Produces (Task 4 relies on these):
  - `dismissRecurring(merchantKey: string): Promise<ActionState>`
  - `restoreRecurring(merchantKey: string): Promise<ActionState>`
  - `saveBill` accepts an optional `merchant_name` form field (stored on insert/update **only when present** — an absent field must never null an existing link).

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0008_recurring_detection.sql`:

```sql
-- Recurring detection: link promoted bills to their merchant and remember dismissals.
alter table bills add column if not exists merchant_name text;

create table if not exists recurring_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_name text not null,  -- normalized merchant key
  created_at timestamptz not null default now(),
  unique (user_id, merchant_name)
);

alter table recurring_dismissals enable row level security;

create policy recurring_dismissals_owner on recurring_dismissals
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Extend `billSchema` and `saveBill`**

In `finance-tracker/web/app/(app)/bills/actions.ts`, add to the `billSchema` object (after `due_month`):

```ts
    merchant_name: z.preprocess(
      (v) => (v === '' || v == null ? undefined : v),
      z.string().trim().optional(),
    ),
```

In `saveBill`, extend the destructure and the row (replace the existing two statements):

```ts
  const { id, name, amount, category, frequency, due_day, due_month, merchant_name } = parsed.data
  const anchored = frequency === 'quarterly' || frequency === 'yearly'
  const row = {
    name,
    amount,
    category,
    frequency,
    due_day,
    due_month: anchored ? due_month : null,
    // Only set when provided — a normal edit (no merchant field in the form)
    // must never wipe an existing merchant link.
    ...(merchant_name ? { merchant_name } : {}),
  }
```

- [ ] **Step 3: Add the dismiss/restore actions**

Append to `finance-tracker/web/app/(app)/bills/actions.ts`:

```ts
export async function dismissRecurring(merchantKey: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  // Upsert with ignoreDuplicates so a double-click is a no-op, not an error.
  const { error } = await supabase.from('recurring_dismissals').upsert(
    { user_id: user.id, merchant_name: merchantKey },
    { onConflict: 'user_id,merchant_name', ignoreDuplicates: true },
  )
  if (error) return { error: 'Could not dismiss.' }
  revalidatePath('/bills')
  return { success: true }
}

export async function restoreRecurring(merchantKey: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error } = await supabase
    .from('recurring_dismissals')
    .delete()
    .eq('user_id', user.id)
    .eq('merchant_name', merchantKey)
  if (error) return { error: 'Could not restore.' }
  revalidatePath('/bills')
  return { success: true }
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds (actions compile; nothing consumes them yet).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/supabase/migrations/0008_recurring_detection.sql finance-tracker/web/app/\(app\)/bills/actions.ts
git commit -m "feat(web): add recurring dismissal schema and bill merchant-link actions"
```

---

### Task 4: UI — `BillForm` prefill, `DetectedRecurring` section, bills-page wiring

**Files:**
- Modify: `finance-tracker/web/components/bills/bill-form.tsx` (optional `prefill` prop)
- Create: `finance-tracker/web/components/bills/detected-recurring.tsx`
- Modify: `finance-tracker/web/components/bills/bills-view.tsx` (render the section)
- Modify: `finance-tracker/web/app/(app)/bills/page.tsx` (fetch + detect + pass down)

**Interfaces:**
- Consumes: `detectRecurring`, `matchCandidates`, `RecurringCandidate` (Tasks 1–2); `dismissRecurring`, `restoreRecurring`, extended `saveBill` (Task 3); `monthlyEquivalent` (Task 1); `RecurringDismissal` type (Task 2).
- Produces: the finished user-facing feature; `BillForm` gains `prefill?: BillPrefill | null` and exports `interface BillPrefill`.

- [ ] **Step 1: Add the `prefill` prop to `BillForm`**

In `finance-tracker/web/components/bills/bill-form.tsx`:

Extend the types import:

```ts
import type { Bill, BillFrequency } from '@/lib/types'
```

Add the exported interface above the component:

```ts
export interface BillPrefill {
  name: string
  amount: number
  category: string
  frequency: BillFrequency
  due_day: number
  due_month: number | null
  merchant_name: string
}
```

Change the component signature and frequency-state init:

```tsx
export function BillForm({
  bill,
  prefill = null,
  onClose,
}: {
  bill: Bill | null
  prefill?: BillPrefill | null
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState(saveBill, initial)
  const [frequency, setFrequency] = useState<string>(bill?.frequency ?? prefill?.frequency ?? 'monthly')
```

Add the hidden merchant field next to the existing hidden `id` input:

```tsx
          {b && <input type="hidden" name="id" value={b.id} />}
          {!b && prefill?.merchant_name && (
            <input type="hidden" name="merchant_name" value={prefill.merchant_name} />
          )}
```

Thread `prefill` into every `defaultValue` (bill wins, then prefill, then the old default):

- Name: `defaultValue={b?.name ?? prefill?.name ?? ''}`
- Amount: `defaultValue={b?.amount ?? prefill?.amount ?? ''}`
- Category: `defaultValue={b?.category ?? prefill?.category ?? SPENDING_CATEGORIES[0]}`
- Frequency: already controlled by the `frequency` state (init updated above)
- Month select: `defaultValue={b?.due_month ?? prefill?.due_month ?? 1}`
- Both day-of-week select and day-of-month input: `defaultValue={b?.due_day ?? prefill?.due_day ?? 1}`

- [ ] **Step 2: Create the `DetectedRecurring` component**

Create `finance-tracker/web/components/bills/detected-recurring.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { monthlyEquivalent } from '@/lib/finance/bill'
import type { RecurringCandidate } from '@/lib/finance/recurring'
import { dismissRecurring, restoreRecurring } from '@/app/(app)/bills/actions'
import { BillForm, type BillPrefill } from './bill-form'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function DetectedRecurring({
  open,
  dismissed,
}: {
  open: RecurringCandidate[]
  dismissed: RecurringCandidate[]
}) {
  const router = useRouter()
  const [tracking, setTracking] = useState<RecurringCandidate | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  async function handleDismiss(c: RecurringCandidate) {
    const res = await dismissRecurring(c.merchantKey)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Dismissed')
      router.refresh()
    }
  }

  async function handleRestore(c: RecurringCandidate) {
    const res = await restoreRecurring(c.merchantKey)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Restored')
      router.refresh()
    }
  }

  const prefill: BillPrefill | null = tracking && {
    name: tracking.displayName,
    amount: tracking.amount,
    category: tracking.categoryGuess,
    frequency: tracking.frequency,
    due_day: tracking.dueDayGuess,
    due_month: tracking.dueMonthGuess,
    merchant_name: tracking.merchantKey,
  }

  return (
    <div className="space-y-2 pt-2">
      <h2 className="text-sm font-medium">Detected recurring</h2>

      {open.length === 0 && dismissed.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recurring charges detected yet — candidates appear after a few months of history.
        </p>
      ) : (
        <>
          {open.map((c) => (
            <Card key={c.merchantKey} className="flex items-center justify-between p-4">
              <div>
                <span className="font-medium">{c.displayName}</span>
                <p className="text-xs text-muted-foreground">
                  {usd(c.amount)} · {c.frequency} · ≈ {usd(monthlyEquivalent(c.amount, c.frequency))}
                  /mo · seen {c.occurrences}×
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setTracking(c)}>
                  Track as bill
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleDismiss(c)}>
                  Dismiss
                </Button>
              </div>
            </Card>
          ))}
          {open.length === 0 && (
            <p className="text-sm text-muted-foreground">
              All detected recurring charges are tracked or dismissed.
            </p>
          )}

          {dismissed.length > 0 && (
            <div>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:underline"
                onClick={() => setShowDismissed((v) => !v)}
              >
                Dismissed ({dismissed.length}) {showDismissed ? '▾' : '▸'}
              </button>
              {showDismissed && (
                <div className="mt-2 space-y-2">
                  {dismissed.map((c) => (
                    <Card key={c.merchantKey} className="flex items-center justify-between p-3">
                      <span className="text-sm text-muted-foreground">
                        {c.displayName} · {usd(c.amount)} · {c.frequency}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => handleRestore(c)}>
                        Restore
                      </Button>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {tracking && prefill && (
        <BillForm bill={null} prefill={prefill} onClose={() => setTracking(null)} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Render the section in `BillsView`**

In `finance-tracker/web/components/bills/bills-view.tsx`:

Add the import:

```ts
import { DetectedRecurring } from './detected-recurring'
import type { RecurringCandidate } from '@/lib/finance/recurring'
```

Extend the props:

```tsx
export function BillsView({
  bills,
  detectedOpen,
  detectedDismissed,
}: {
  bills: Bill[]
  detectedOpen: RecurringCandidate[]
  detectedDismissed: RecurringCandidate[]
}) {
```

Render the section **after** the `{bills.length === 0 ? ... : ...}` block and **before** the `{(creating || editing) && (<BillForm .../>)}` block — outside the empty-state conditional, so detection shows even with zero tracked bills:

```tsx
      <DetectedRecurring open={detectedOpen} dismissed={detectedDismissed} />
```

- [ ] **Step 4: Wire the bills page**

Replace the body of `finance-tracker/web/app/(app)/bills/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { BillsView } from '@/components/bills/bills-view'
import { detectRecurring, matchCandidates } from '@/lib/finance/recurring'
import type { Bill, RecurringDismissal, Transaction } from '@/lib/types'

export default async function BillsPage() {
  const supabase = await createClient()
  const today = new Date()
  const windowStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 13, today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)

  const [{ data: bills }, { data: txns }, { data: dismissals }] = await Promise.all([
    supabase.from('bills').select('*').order('name'),
    supabase.from('transactions').select('*').gte('date', windowStart),
    supabase.from('recurring_dismissals').select('*'),
  ])

  const billRows = (bills ?? []) as Bill[]
  const candidates = detectRecurring((txns ?? []) as Transaction[], today)
  const { open, dismissed } = matchCandidates(
    candidates,
    billRows,
    ((dismissals ?? []) as RecurringDismissal[]).map((d) => d.merchant_name),
  )

  return <BillsView bills={billRows} detectedOpen={open} detectedDismissed={dismissed} />
}
```

- [ ] **Step 5: Verify the build and full test suite**

Run: `npm run build`
Expected: build succeeds.

Run: `npx vitest run`
Expected: entire suite passes (168 pre-existing + 21 new = 189).

- [ ] **Step 6: Manual smoke test**

After applying migration `0008` to the Supabase project (see Post-Implementation), start `npm run dev` and confirm on `/bills`:

1. A **"Detected recurring"** section appears below the bills list, showing candidates from your synced history (each with amount · frequency · ≈$/mo · seen N×), biggest monthly impact first.
2. A merchant already covered by a tracked bill (matching name) does **not** appear.
3. **Dismiss** a candidate → it moves under a collapsed "Dismissed (N)" disclosure; **Restore** brings it back; a page reload persists both.
4. **Track as bill** on a candidate → the bill form opens prefilled (name/amount/frequency/day/month/category); save it → the candidate disappears from the section and the new bill appears in the list above, and (verify in Supabase or via a re-render) the bill row carries the normalized `merchant_name`.
5. Editing that bill later (rename it) keeps it tracked (the merchant link, not the name, matches).
6. With no detectable history the section shows the muted empty line.

- [ ] **Step 7: Update project docs**

In `C:\Users\kharb\CLAUDE.md` (untracked project-instructions file — edit, no commit):
- Add a **"Recurring detection (Plan 9)"** subsection to the Web App section: pure detector in `lib/finance/recurring.ts` (13-month window, cadence bands, ±20% interval / ±30% amount guards, normalized merchant keys), `matchCandidates` (exact `bills.merchant_name` link or fuzzy name fallback; tracked > dismissed > open), migration `0008` (`bills.merchant_name` + `recurring_dismissals`), `/bills` "Detected recurring" section with Track-as-bill (prefilled `BillForm`) and Dismiss/Restore; detection recomputed per page load, no stored results.
- Add Plan 9 to the Plans list with its status.

- [ ] **Step 8: Commit**

```bash
git add finance-tracker/web/components/bills/bill-form.tsx finance-tracker/web/components/bills/detected-recurring.tsx finance-tracker/web/components/bills/bills-view.tsx finance-tracker/web/app/\(app\)/bills/page.tsx
git commit -m "feat(web): show detected recurring charges on the bills page"
```

---

## Post-Implementation

- **Apply migration `0008_recurring_detection.sql`** to the Supabase project (dashboard SQL editor or `supabase db push`) before the feature works end-to-end — same requirement as every prior migration.
- Mark this plan complete in `CLAUDE.md` once the manual smoke test passes.

## Notes / Known Trade-offs (from the spec)

- Detection quality is bounded by Plaid's `merchant_name` consistency; a renamed merchant ages out of the window naturally.
- A promoted bill later deleted correctly reverts its candidate to **open**.
- A dismissal never blocks tracking — "Track as bill" stays available via Restore → Track (tracked precedence also hides the row once a bill covers it).
- Plaid's `/transactions/recurring` API was considered and rejected (extra product surface, no manual-transaction coverage, untestable black box).
