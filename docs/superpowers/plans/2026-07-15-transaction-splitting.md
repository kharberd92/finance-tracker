# Transaction Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user split one transaction across multiple categories so every category rollup (budgets, spent-vs-budget, cashflow) counts the split parts instead of the parent's single category.

**Architecture:** A child `transaction_splits` table holds the parts; the parent `transactions.category` becomes the sentinel `'Split'`. A single pure function `explodeSplits` replaces each split parent with per-part virtual rows at the data-fetch boundary, so the existing tested finance-logic library (`spentThisMonth`, `monthlyCashflow`, `budgetStatus`) is fed exploded rows and never changes. The `/transactions` list keeps parent rows 1:1 and edits splits in the existing Tailwind modal.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Supabase (`@supabase/ssr`) · Zod 4 · Vitest · Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-15-transaction-splitting-design.md`

## Global Constraints

- **Next.js 16 conventions** — see `finance-tracker/web/AGENTS.md`; `cookies()` is async; verify APIs against `node_modules/next/dist/docs/` before writing code.
- **`lib/finance/` stays Supabase/React-free** — pure, unit-tested logic only. Server fetch helpers go elsewhere (`lib/transactions/`).
- **Sentinel** category string is exactly `'Split'`; split parts must each be a valid `CATEGORIES` member.
- **Sign convention:** `transactions.amount` and `transaction_splits.amount` are negative for expenses, positive for income; part magnitudes sum to `|parent amount|`.
- **All money math tolerant to 1 cent** (`< 0.01`), values rounded to cents.
- **Commands** (run from `finance-tracker/web`): `npx vitest run <file>` for a single test file; `npm run build` for the production build/typecheck.
- **Every action resolves the user from the session** (`supabase.auth.getUser()`), never from the request body.
- Follow the existing modal style: native `<select>`/inputs + the existing Tailwind modal (not shadcn Dialog/Select).

---

### Task 1: Data model — migration, type, sentinel constant

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0007_transaction_splits.sql`
- Modify: `finance-tracker/web/lib/types.ts` (add `TransactionSplit`)
- Modify: `finance-tracker/web/lib/finance/categories.ts` (add `SPLIT_CATEGORY`)
- Test: `finance-tracker/web/lib/finance/categories.test.ts`

**Interfaces:**
- Produces: `TransactionSplit` interface; `SPLIT_CATEGORY = 'Split'` constant.

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0007_transaction_splits.sql`:

```sql
-- Transaction splitting: a transaction can be divided across multiple categories.
-- Parent transactions.category is set to 'Split'; the parts live here.
create table if not exists transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references transactions (id) on delete cascade,
  category text not null,
  amount numeric not null,      -- same sign as parent (negative = expense)
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_splits_txn on transaction_splits (transaction_id);
create index if not exists idx_transaction_splits_user on transaction_splits (user_id);

alter table transaction_splits enable row level security;

create policy transaction_splits_owner on transaction_splits
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- [ ] **Step 2: Add the `TransactionSplit` type**

In `finance-tracker/web/lib/types.ts`, after the `Transaction` interface (around line 25), add:

```ts
export interface TransactionSplit {
  id: string
  user_id: string
  transaction_id: string
  category: string
  amount: number // same sign as parent (negative = expense)
}
```

- [ ] **Step 3: Add the `SPLIT_CATEGORY` sentinel**

In `finance-tracker/web/lib/finance/categories.ts`, after the `CATEGORIES` array / `Category` type (around line 16), add:

```ts
/** Sentinel stored in transactions.category when a transaction is split across parts. Never a pickable category. */
export const SPLIT_CATEGORY = 'Split'
```

- [ ] **Step 4: Write the failing test**

Append to `finance-tracker/web/lib/finance/categories.test.ts`:

```ts
import { SPLIT_CATEGORY } from './categories'

describe('SPLIT_CATEGORY sentinel', () => {
  it('is the literal "Split"', () => {
    expect(SPLIT_CATEGORY).toBe('Split')
  })

  it('is never a pickable category', () => {
    expect(isCategory(SPLIT_CATEGORY)).toBe(false)
    expect(isSpendingCategory(SPLIT_CATEGORY)).toBe(false)
  })
})
```

(If `isCategory`/`isSpendingCategory` are not already imported at the top of the file, add them to the existing import from `./categories`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/finance/categories.test.ts`
Expected: PASS (the constant and type are already added).

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/supabase/migrations/0007_transaction_splits.sql finance-tracker/web/lib/types.ts finance-tracker/web/lib/finance/categories.ts finance-tracker/web/lib/finance/categories.test.ts
git commit -m "feat(web): add transaction_splits schema, type, and Split sentinel"
```

---

### Task 2: Pure split logic — `lib/finance/split.ts`

**Files:**
- Create: `finance-tracker/web/lib/finance/split.ts`
- Test: `finance-tracker/web/lib/finance/split.test.ts`

**Interfaces:**
- Consumes: `Transaction`, `TransactionSplit` from `@/lib/types`.
- Produces:
  - `explodeSplits(transactions: Transaction[], splits: TransactionSplit[]): Transaction[]`
  - `splitTotal(splits: { amount: number }[]): number`
  - `splitsMatchParent(parentAmount: number, splits: { amount: number }[]): boolean`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/split.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { explodeSplits, splitTotal, splitsMatchParent } from './split'
import type { Transaction, TransactionSplit } from '@/lib/types'

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    user_id: 'u1',
    account_id: 'a1',
    amount: -100,
    date: '2026-07-10',
    merchant_name: 'Target',
    category: 'Split',
    is_manual: false,
    ...over,
  }
}

function split(over: Partial<TransactionSplit> = {}): TransactionSplit {
  return { id: 's1', user_id: 'u1', transaction_id: 't1', category: 'Groceries', amount: -60, ...over }
}

describe('splitTotal', () => {
  it('sums magnitudes rounded to cents', () => {
    expect(splitTotal([{ amount: -60 }, { amount: -40 }])).toBe(100)
    expect(splitTotal([{ amount: -33.33 }, { amount: -33.33 }, { amount: -33.34 }])).toBe(100)
  })
})

describe('splitsMatchParent', () => {
  it('true when magnitudes equal the parent magnitude', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -40 }])).toBe(true)
    expect(splitsMatchParent(100, [{ amount: 60 }, { amount: 40 }])).toBe(true)
  })
  it('tolerates a sub-cent difference', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -39.995 }])).toBe(true)
  })
  it('false when parts do not add up', () => {
    expect(splitsMatchParent(-100, [{ amount: -60 }, { amount: -30 }])).toBe(false)
  })
})

describe('explodeSplits', () => {
  it('passes non-split transactions through unchanged', () => {
    const t = txn({ id: 't9', category: 'Groceries', amount: -20 })
    expect(explodeSplits([t], [])).toEqual([t])
  })

  it('replaces a split parent with one row per part', () => {
    const t = txn()
    const parts = [split({ id: 's1', category: 'Groceries', amount: -60 }), split({ id: 's2', category: 'Shopping', amount: -40 })]
    const out = explodeSplits([t], parts)
    expect(out).toHaveLength(2)
    expect(out.map((r) => r.category)).toEqual(['Groceries', 'Shopping'])
    expect(out.map((r) => r.amount)).toEqual([-60, -40])
    // parent fields preserved
    expect(out[0].date).toBe('2026-07-10')
    expect(out[0].merchant_name).toBe('Target')
    expect(out[0].account_id).toBe('a1')
    // synthetic ids are unique
    expect(new Set(out.map((r) => r.id)).size).toBe(2)
  })

  it('leaves other transactions untouched while exploding one', () => {
    const a = txn({ id: 't1' })
    const b = txn({ id: 't2', category: 'Travel', amount: -50 })
    const out = explodeSplits([a, b], [split({ transaction_id: 't1', amount: -60 }), split({ id: 's2', transaction_id: 't1', category: 'Shopping', amount: -40 })])
    expect(out).toHaveLength(3)
    expect(out.find((r) => r.id === 't2')).toEqual(b)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/split.test.ts`
Expected: FAIL — "Failed to resolve import './split'".

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/finance/split.ts`:

```ts
import type { Transaction, TransactionSplit } from '@/lib/types'

const CENT = 0.01

/** Sum of split magnitudes, rounded to cents. */
export function splitTotal(splits: { amount: number }[]): number {
  const sum = splits.reduce((acc, s) => acc + Math.abs(s.amount), 0)
  return Math.round(sum * 100) / 100
}

/** True when the parts' magnitudes add up to the parent magnitude (within 1 cent). */
export function splitsMatchParent(parentAmount: number, splits: { amount: number }[]): boolean {
  return Math.abs(splitTotal(splits) - Math.abs(parentAmount)) < CENT
}

/**
 * Replaces each split parent with one virtual Transaction per part (parent fields copied;
 * category/amount from the part; a unique synthetic id `${txnId}:${splitId}`). Transactions
 * with no splits pass through unchanged.
 */
export function explodeSplits(
  transactions: Transaction[],
  splits: TransactionSplit[],
): Transaction[] {
  const byTxn = new Map<string, TransactionSplit[]>()
  for (const s of splits) {
    const list = byTxn.get(s.transaction_id) ?? []
    list.push(s)
    byTxn.set(s.transaction_id, list)
  }
  const out: Transaction[] = []
  for (const t of transactions) {
    const parts = byTxn.get(t.id)
    if (!parts || parts.length === 0) {
      out.push(t)
      continue
    }
    for (const p of parts) {
      out.push({ ...t, id: `${t.id}:${p.id}`, category: p.category, amount: p.amount })
    }
  }
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/split.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/split.ts finance-tracker/web/lib/finance/split.test.ts
git commit -m "feat(web): add pure split logic (explodeSplits, splitTotal, splitsMatchParent)"
```

---

### Task 3: Server actions — save & remove splits

**Files:**
- Modify: `finance-tracker/web/app/(app)/transactions/actions.ts`
- Test: `finance-tracker/web/app/(app)/transactions/actions.test.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`; `isCategory`, `SPLIT_CATEGORY` from `@/lib/finance/categories`; `splitsMatchParent` from `@/lib/finance/split`; existing `ActionState`, `categoryField`.
- Produces:
  - `saveTransactionSplits(_prev: ActionState, formData: FormData): Promise<ActionState>` — expects `id` (transaction id) and `splits` (JSON string of `{ category: string, amount: number }[]`, amounts positive magnitudes, ≥ 2 parts).
  - `removeTransactionSplits(id: string): Promise<ActionState>`

- [ ] **Step 1: Write the failing tests**

Append to `finance-tracker/web/app/(app)/transactions/actions.test.ts`. Add `saveTransactionSplits, removeTransactionSplits` to the existing import from `./actions`, then add:

```ts
const TXN_ID = '11111111-1111-1111-1111-111111111111'

describe('saveTransactionSplits', () => {
  it('rejects fewer than two parts', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 100 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects a part with an invalid category', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Bogus', amount: 60 }, { category: 'Shopping', amount: 40 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('rejects parts that do not sum to the parent amount', async () => {
    const txns = createQueryStub({ data: { amount: -100 }, error: null })
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ tables: { transactions: txns } }) as never)
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 60 }, { category: 'Shopping', amount: 30 }]) }),
    )
    expect(res.error).toBeTruthy()
  })

  it('signs parts to the parent sign, inserts them, and flags the parent as Split', async () => {
    const txns = createQueryStub({ data: { amount: -100 }, error: null })
    const splits = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { transactions: txns, transaction_splits: splits } }) as never,
    )
    const res = await saveTransactionSplits(
      {},
      fd({ id: TXN_ID, splits: JSON.stringify([{ category: 'Groceries', amount: 60 }, { category: 'Shopping', amount: 40 }]) }),
    )
    expect(res.success).toBe(true)
    expect(splits.delete).toHaveBeenCalled()
    const inserted = splits.insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ transaction_id: TXN_ID, category: 'Groceries', amount: -60 })
    expect(inserted[1]).toMatchObject({ category: 'Shopping', amount: -40 })
    expect(txns.update).toHaveBeenCalledWith({ category: 'Split' })
  })
})

describe('removeTransactionSplits', () => {
  it('deletes the parts and reverts the parent to Uncategorized', async () => {
    const txns = createQueryStub()
    const splits = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { transactions: txns, transaction_splits: splits } }) as never,
    )
    const res = await removeTransactionSplits(TXN_ID)
    expect(res.success).toBe(true)
    expect(splits.delete).toHaveBeenCalled()
    expect(txns.update).toHaveBeenCalledWith({ category: 'Uncategorized' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/\(app\)/transactions/actions.test.ts`
Expected: FAIL — `saveTransactionSplits`/`removeTransactionSplits` not exported.

- [ ] **Step 3: Write the implementation**

In `finance-tracker/web/app/(app)/transactions/actions.ts`, update the imports and append the actions. Change the categories import to include the sentinel and add the split-logic import near the top:

```ts
import { isCategory, SPLIT_CATEGORY } from '@/lib/finance/categories'
import { splitsMatchParent } from '@/lib/finance/split'
```

Then append at the end of the file:

```ts
const splitPartSchema = z.object({
  category: categoryField,
  amount: z.coerce.number().positive('Split amounts must be greater than 0'),
})

const splitsSchema = z.object({
  id: z.string().min(1),
  splits: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Could not read the split parts.' })
        return z.NEVER
      }
    })
    .pipe(z.array(splitPartSchema).min(2, 'A split needs at least two categories')),
})

export async function saveTransactionSplits(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const parsed = splitsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0].message }
  const { id, splits } = parsed.data

  // Resolve the parent amount from the DB (never trust the client for it).
  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('amount')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (txnErr || !txn) return { error: 'Could not find that transaction.' }

  const parentAmount = Number(txn.amount)
  if (!splitsMatchParent(parentAmount, splits)) {
    return { error: 'Split amounts must add up to the transaction total.' }
  }

  const sign = parentAmount < 0 ? -1 : 1
  const rows = splits.map((p) => ({
    user_id: user.id,
    transaction_id: id,
    category: p.category,
    amount: sign * Math.abs(p.amount),
  }))

  const { error: delErr } = await supabase.from('transaction_splits').delete().eq('transaction_id', id)
  if (delErr) return { error: 'Could not save the split.' }
  const { error: insErr } = await supabase.from('transaction_splits').insert(rows)
  if (insErr) return { error: 'Could not save the split.' }
  const { error: updErr } = await supabase
    .from('transactions')
    .update({ category: SPLIT_CATEGORY })
    .eq('id', id)
  if (updErr) return { error: 'Could not save the split.' }

  revalidatePath('/transactions')
  return { success: true }
}

export async function removeTransactionSplits(id: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }

  const { error: delErr } = await supabase.from('transaction_splits').delete().eq('transaction_id', id)
  if (delErr) return { error: 'Could not remove the split.' }
  const { error: updErr } = await supabase
    .from('transactions')
    .update({ category: 'Uncategorized' })
    .eq('id', id)
  if (updErr) return { error: 'Could not remove the split.' }

  revalidatePath('/transactions')
  return { success: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/\(app\)/transactions/actions.test.ts`
Expected: PASS (all existing and new cases).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/\(app\)/transactions/actions.ts finance-tracker/web/app/\(app\)/transactions/actions.test.ts
git commit -m "feat(web): add saveTransactionSplits / removeTransactionSplits actions"
```

---

### Task 4: Fetch helper + wire rollups (dashboard & budgets)

**Files:**
- Create: `finance-tracker/web/lib/transactions/fetch-splits.ts`
- Test: `finance-tracker/web/lib/transactions/fetch-splits.test.ts`
- Modify: `finance-tracker/web/app/(app)/page.tsx` (dashboard)
- Modify: `finance-tracker/web/app/(app)/budgets/page.tsx`

**Interfaces:**
- Consumes: a Supabase client; `TransactionSplit` from `@/lib/types`; `explodeSplits` from `@/lib/finance/split`.
- Produces: `fetchSplitsFor(supabase: SupabaseClient, transactionIds: string[]): Promise<TransactionSplit[]>` — returns `[]` for an empty id list.

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/transactions/fetch-splits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fetchSplitsFor } from './fetch-splits'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

describe('fetchSplitsFor', () => {
  it('returns [] without querying when there are no ids', async () => {
    const splits = createQueryStub()
    const supabase = createSupabaseMock({ tables: { transaction_splits: splits } })
    const res = await fetchSplitsFor(supabase as never, [])
    expect(res).toEqual([])
    expect(splits.select).not.toHaveBeenCalled()
  })

  it('queries transaction_splits filtered by the ids', async () => {
    const rows = [{ id: 's1', user_id: 'u1', transaction_id: 't1', category: 'Groceries', amount: -60 }]
    const splits = createQueryStub({ data: rows, error: null })
    const supabase = createSupabaseMock({ tables: { transaction_splits: splits } })
    const res = await fetchSplitsFor(supabase as never, ['t1'])
    expect(res).toEqual(rows)
    expect(splits.in).toHaveBeenCalledWith('transaction_id', ['t1'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/transactions/fetch-splits.test.ts`
Expected: FAIL — "Failed to resolve import './fetch-splits'".

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/transactions/fetch-splits.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TransactionSplit } from '@/lib/types'

/** Splits belonging to the given transaction ids (RLS scopes them to the current user). */
export async function fetchSplitsFor(
  supabase: SupabaseClient,
  transactionIds: string[],
): Promise<TransactionSplit[]> {
  if (transactionIds.length === 0) return []
  const { data } = await supabase
    .from('transaction_splits')
    .select('*')
    .in('transaction_id', transactionIds)
  return (data ?? []) as TransactionSplit[]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/transactions/fetch-splits.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the budgets page to count split parts**

In `finance-tracker/web/app/(app)/budgets/page.tsx`, add imports and explode before rendering. Replace the body from the `supabase` fetch through the return with:

```ts
  const supabase = await createClient()
  const [{ data: budgets }, { data: txns }] = await Promise.all([
    supabase.from('budgets').select('*').order('category'),
    supabase.from('transactions').select('*').gte('date', start).lt('date', end),
  ])

  const transactions = (txns ?? []) as Transaction[]
  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))
  const exploded = explodeSplits(transactions, splits)

  return (
    <BudgetsView
      month={ym}
      budgets={(budgets ?? []) as Budget[]}
      transactions={exploded}
    />
  )
```

Add these imports at the top:

```ts
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import { explodeSplits } from '@/lib/finance/split'
```

- [ ] **Step 6: Wire the dashboard rollups to count split parts (keep recent-transactions raw)**

In `finance-tracker/web/app/(app)/page.tsx`, after the line `const transactions = (txnsRes.data ?? []) as Transaction[]` (around line 39), add:

```ts
  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))
  const exploded = explodeSplits(transactions, splits)
```

Change the cashflow line (around line 44) and the budget widget (around line 76) to use `exploded`; leave the recent-transactions widget on raw `transactions`:

```ts
  const rows = monthlyCashflow(exploded, months)
```

```tsx
        <BudgetWidget budgets={budgets} transactions={exploded} year={year} month={mon} />
```

`<RecentTransactionsWidget transactions={transactions} />` stays unchanged (raw parent rows).

Add the imports at the top:

```ts
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import { explodeSplits } from '@/lib/finance/split'
```

- [ ] **Step 7: Verify the build and that existing rollup tests still pass**

Run: `npx vitest run lib/finance/budget.test.ts lib/finance/cashflow.test.ts lib/transactions/fetch-splits.test.ts`
Expected: PASS (rollup tests unchanged and green — proves the reshaping is isolated).

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 8: Commit**

```bash
git add finance-tracker/web/lib/transactions/fetch-splits.ts finance-tracker/web/lib/transactions/fetch-splits.test.ts finance-tracker/web/app/\(app\)/page.tsx finance-tracker/web/app/\(app\)/budgets/page.tsx
git commit -m "feat(web): explode splits into budgets and dashboard rollups"
```

---

### Task 5: Transactions page + list display & filter

**Files:**
- Modify: `finance-tracker/web/app/(app)/transactions/page.tsx`
- Modify: `finance-tracker/web/components/transactions/transactions-view.tsx`

**Interfaces:**
- Consumes: `fetchSplitsFor`; `SPLIT_CATEGORY` from `@/lib/finance/categories`; `TransactionSplit` from `@/lib/types`.
- Produces: `TransactionsView` gains a `splits: TransactionSplit[]` prop and passes splits into the edit modal (consumed by Task 6).

- [ ] **Step 1: Fetch splits in the transactions page and pass them down**

In `finance-tracker/web/app/(app)/transactions/page.tsx`, replace the fetch/return block (lines 20–37) with:

```ts
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

  const transactions = (txns ?? []) as Transaction[]
  const splits = await fetchSplitsFor(supabase, transactions.map((t) => t.id))

  return (
    <TransactionsView
      month={ym}
      transactions={transactions}
      splits={splits}
      accounts={(accts ?? []) as Account[]}
    />
  )
```

Add to the imports at the top:

```ts
import { fetchSplitsFor } from '@/lib/transactions/fetch-splits'
import type { Account, Transaction, TransactionSplit } from '@/lib/types'
```

(Replace the existing `import type { Account, Transaction }` line so `TransactionSplit` is included.)

- [ ] **Step 2: Accept splits, group them, and show "Split (N)" + filter by part**

In `finance-tracker/web/components/transactions/transactions-view.tsx`:

Update imports:

```ts
import { CATEGORIES, SPLIT_CATEGORY } from '@/lib/finance/categories'
import type { Account, Transaction, TransactionSplit } from '@/lib/types'
```

Add `splits` to the props and build a per-transaction map (place after the destructured props, alongside the other `useMemo`s):

```tsx
export function TransactionsView({
  month,
  transactions,
  splits,
  accounts,
}: {
  month: string
  transactions: Transaction[]
  splits: TransactionSplit[]
  accounts: Account[]
}) {
```

```tsx
  const splitsByTxn = useMemo(() => {
    const m: Record<string, TransactionSplit[]> = {}
    for (const s of splits) (m[s.transaction_id] ??= []).push(s)
    return m
  }, [splits])
```

Update the filter so a category selection matches a split part, and add the `Split` option. Replace the category test inside `filtered`:

```tsx
        if (categoryFilter !== 'all') {
          const parts = splitsByTxn[t.id]
          const matches =
            categoryFilter === SPLIT_CATEGORY
              ? t.category === SPLIT_CATEGORY
              : parts
                ? parts.some((p) => p.category === categoryFilter)
                : t.category === categoryFilter
          if (!matches) return false
        }
```

Add `splitsByTxn` to the `filtered` `useMemo` dependency array.

Add a `Split` option to the category filter `<select>` (after the `CATEGORIES.map(...)` options):

```tsx
          <option value={SPLIT_CATEGORY}>Split</option>
```

Render the category pill so a split shows its part count. Replace the pill span (around line 126):

```tsx
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {t.category === SPLIT_CATEGORY
                    ? `Split (${splitsByTxn[t.id]?.length ?? 0})`
                    : t.category}
                </span>
```

Pass the transaction's splits into the modal. Update the `TransactionForm` render (around line 141):

```tsx
        <TransactionForm
          accounts={accounts}
          transaction={editing}
          splits={editing ? splitsByTxn[editing.id] ?? [] : []}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: build succeeds. (`TransactionForm` gains a `splits` prop in Task 6; until then TypeScript will flag the unknown prop — implement Task 6 before the final build gate. To keep this task independently buildable, temporarily accept `splits` in `TransactionForm`'s props as `splits: TransactionSplit[]` with no other change, then flesh it out in Task 6.)

To keep Task 5 self-contained, add a minimal prop stub to `finance-tracker/web/components/transactions/transaction-form.tsx` now — add `splits` to its props type and destructuring (unused this task):

```tsx
import type { Account, Transaction, TransactionSplit } from '@/lib/types'
```

```tsx
export function TransactionForm({
  accounts,
  transaction,
  splits,
  onClose,
}: {
  accounts: Account[]
  transaction: Transaction | null
  splits: TransactionSplit[]
  onClose: () => void
}) {
```

Then re-run `npm run build`. Expected: succeeds (the `splits` param is unused for now; if lint fails on an unused var, prefix usage arrives in Task 6 — acceptable interim, or reference it via `void splits`).

- [ ] **Step 4: Commit**

```bash
git add finance-tracker/web/app/\(app\)/transactions/page.tsx finance-tracker/web/components/transactions/transactions-view.tsx finance-tracker/web/components/transactions/transaction-form.tsx
git commit -m "feat(web): show Split (N) and filter transactions by split part"
```

---

### Task 6: Edit-modal split editor

**Files:**
- Modify: `finance-tracker/web/components/transactions/transaction-form.tsx`

**Interfaces:**
- Consumes: `saveTransactionSplits`, `removeTransactionSplits` from `@/app/(app)/transactions/actions`; `splitTotal`, `splitsMatchParent` from `@/lib/finance/split`; `CATEGORIES` from `@/lib/finance/categories`; the `splits` prop added in Task 5.
- Produces: end-to-end splitting UI (the feature's user-facing surface).

- [ ] **Step 1: Add split state and handlers**

In `finance-tracker/web/components/transactions/transaction-form.tsx`, extend the imports:

```ts
import { useActionState, useEffect, useState } from 'react'
import { CATEGORIES } from '@/lib/finance/categories'
import { splitTotal, splitsMatchParent } from '@/lib/finance/split'
import {
  saveManualTransaction,
  updateTransactionCategory,
  deleteManualTransaction,
  saveTransactionSplits,
  removeTransactionSplits,
  type ActionState,
} from '@/app/(app)/transactions/actions'
```

Inside the component (after the existing `handleDelete`), add split-editor state and handlers. Parts are held as positive-magnitude strings for the inputs:

```tsx
  type Part = { category: string; amount: string }
  const [parts, setParts] = useState<Part[]>(
    splits.length > 0
      ? splits.map((s) => ({ category: s.category, amount: String(Math.abs(s.amount)) }))
      : [
          { category: 'Groceries', amount: '' },
          { category: 'Shopping', amount: '' },
        ],
  )
  const [splitOpen, setSplitOpen] = useState(splits.length > 0)

  const partAmounts = parts.map((p) => ({ amount: Number(p.amount) || 0 }))
  const allocated = splitTotal(partAmounts)
  const parentMagnitude = t ? Math.abs(t.amount) : 0
  const splitsBalance = t ? splitsMatchParent(t.amount, partAmounts) : false

  function updatePart(i: number, patch: Partial<Part>) {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function addPart() {
    setParts((prev) => [...prev, { category: 'Uncategorized', amount: '' }])
  }
  function removePart(i: number) {
    setParts((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSaveSplits() {
    if (!t) return
    const form = new FormData()
    form.set('id', t.id)
    form.set(
      'splits',
      JSON.stringify(parts.map((p) => ({ category: p.category, amount: Number(p.amount) || 0 }))),
    )
    const res = await saveTransactionSplits({}, form)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Split saved')
      router.refresh()
      onClose()
    }
  }

  async function handleRemoveSplits() {
    if (!t) return
    const res = await removeTransactionSplits(t.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      toast.success('Split removed')
      router.refresh()
      onClose()
    }
  }
```

- [ ] **Step 2: Render the split section**

Add a split section inside the modal, only for existing transactions (`t` is set). Place it just before the closing action-buttons row (before the `<div className="flex items-center justify-between gap-2">` at ~line 155):

```tsx
          {t && (
            <div className="rounded-md border border-input p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Split transaction</span>
                {!splitOpen && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setSplitOpen(true)}>
                    {splits.length > 0 ? 'Edit split' : 'Split'}
                  </Button>
                )}
              </div>

              {splitOpen && (
                <div className="mt-3 space-y-2">
                  {parts.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <select
                        aria-label={`Split ${i + 1} category`}
                        className={fieldClass}
                        value={p.category}
                        onChange={(e) => updatePart(i, { category: e.target.value })}
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label={`Split ${i + 1} amount`}
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28"
                        value={p.amount}
                        onChange={(e) => updatePart(i, { amount: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removePart(i)}
                        disabled={parts.length <= 2}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}

                  <Button type="button" variant="outline" size="sm" onClick={addPart}>
                    + Add split
                  </Button>

                  <p className={`text-xs ${splitsBalance ? 'text-muted-foreground' : 'text-destructive'}`}>
                    Allocated {allocated.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} of{' '}
                    {parentMagnitude.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                  </p>

                  <div className="flex gap-2">
                    <Button type="button" onClick={handleSaveSplits} disabled={!splitsBalance}>
                      Save split
                    </Button>
                    {splits.length > 0 && (
                      <Button type="button" variant="destructive" onClick={handleRemoveSplits}>
                        Remove split
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 3: Verify the build and full test suite**

Run: `npm run build`
Expected: build succeeds, no unused-var or type errors (the `splits` prop is now consumed).

Run: `npx vitest run`
Expected: entire suite passes.

- [x] **Step 4: Manual smoke test** — passed 2026-07-18 (all 6 steps; initial "Could not save the split" was just migration `0007` not yet applied).

Start the dev server (`npm run dev`, requires `.env.local`) and confirm end-to-end (after applying migration `0007` to the Supabase project — see the Post-Implementation note):

1. Open `/transactions`, click a transaction, click **Split**, set e.g. $60 Groceries + $40 Shopping on a $100 charge. "Save split" is disabled until the allocated total matches; save it.
2. The list row now reads **"Split (2)"**.
3. Filter by **Groceries** → the split transaction appears; filter by **Split** → it appears; filter by a category not in the split → it does not.
4. `/budgets` for that month: the $60 lands in Groceries, $40 in Shopping.
5. Dashboard cashflow/budget widget reflect the parts; the recent-transactions widget still shows one row.
6. Reopen the transaction, **Remove split** → row reverts to a single **Uncategorized** category.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/components/transactions/transaction-form.tsx
git commit -m "feat(web): add split editor to the transaction modal"
```

---

## Post-Implementation

- **Apply migration `0007_transaction_splits.sql`** to the Supabase project (dashboard SQL editor or `supabase db push`) before the feature works end-to-end — same requirement as every prior migration. **Applied 2026-07-18.**
- Update `finance-tracker/CLAUDE.md` (or the web `AGENTS.md`) with a short "Transaction splitting" subsection and mark this plan complete, mirroring how prior plans are recorded.

## Notes / Known Trade-offs (from the spec)

- The three-step save (delete parts → insert parts → flag parent) is **not** wrapped in a DB transaction; a mid-sequence failure could leave a transient inconsistency. Re-saving repairs it. Acceptable for a single-user personal app (a Postgres RPC could make it atomic later).
- If a Plaid `modified` sync changes a split transaction's amount, the parts may no longer sum; the modal's "Allocated X of Y" line turns red (via `splitsMatchParent`) so the user re-splits. Nothing is auto-deleted. Sync already never overwrites `category`, so the `'Split'` flag and parts survive re-sync.
```
