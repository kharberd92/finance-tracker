# Transaction Splitting — Design

**Date:** 2026-07-15
**Status:** Approved, ready for planning
**Context:** Deferred enhancement from Plan 5a (transactions). Parked on 2026-06-13 until budgets/charts existed; those are now complete (Plan 5 done, UI refresh merged).

## Problem

A single transaction often belongs to more than one category — a $100 Target run might be
$60 Groceries + $40 Shopping. Today a transaction carries exactly one `category`, so it lands
entirely in one budget/cashflow bucket. Users want to split one transaction across multiple
categories and have **every category rollup** (budgets, spent-vs-budget, cashflow) count the
split parts, not the parent's single category.

## Product decisions (settled during brainstorming)

- **Any** transaction is splittable — both Plaid-synced and manual.
- A split must allocate the **entire** amount: child part magnitudes sum **exactly** to the
  parent amount (no unallocated remainder). Minimum **2** parts.
- The parent's `category` becomes the sentinel `'Split'`.
- In the `/transactions` list, a split shows as **one collapsed row** (Option A), category cell
  reads `"Split (N)"`; the breakdown is viewed/edited in the edit modal. The list stays 1:1 with
  the bank statement / manual entry.
- Rollups aggregate by the individual split parts regardless of list display.

## Architecture — "Explode at the fetch boundary" (chosen over split-aware aggregators / denormalizing)

The reshaping is isolated to **one new pure module plus one migration plus thin per-page wiring**.
The existing, tested finance-logic library (`spentThisMonth`, `monthlyCashflow`, `budgetStatus`)
is **not modified** — it keeps iterating `Transaction[]` by a single `category`; we simply feed it
*exploded* rows.

### 1. Data model — migration `0007_transaction_splits.sql`

```sql
create table if not exists transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references transactions (id) on delete cascade,
  category text not null,
  amount numeric not null,      -- same sign convention as parent (negative = expense)
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_splits_txn on transaction_splits (transaction_id);
create index if not exists idx_transaction_splits_user on transaction_splits (user_id);

alter table transaction_splits enable row level security;
create policy transaction_splits_owner on transaction_splits
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

- `on delete cascade` on `transaction_id`: deleting a transaction (including a Plaid `removed`
  transaction, which the sync deletes) auto-removes its split rows.
- Parent `transactions.category` is set to the sentinel `'Split'`.
- **Migration must be applied** to the Supabase project (dashboard SQL editor or `supabase db push`)
  before the feature works end-to-end — same as every prior migration.

### 2. Sentinel category

- `'Split'` is **not** added to `CATEGORIES` (which stays the pickable vocabulary for both regular
  transactions and split parts). It is a new exported constant in `lib/finance/categories.ts`:
  `export const SPLIT_CATEGORY = 'Split'`.
- Split **parts** must each be a valid `CATEGORIES` member (validated via the existing `isCategory`).
- Because `'Split'` never enters `CATEGORIES`/`SPENDING_CATEGORIES`, the budgets dropdown and the
  Plaid mapper are unaffected.

### 3. Pure logic — `lib/finance/split.ts` (fully unit-tested, no Supabase/React deps)

```ts
export interface TransactionSplit {
  id: string
  user_id: string
  transaction_id: string
  category: string
  amount: number
}

// Replaces each split parent with N virtual rows (parent fields copied; category/amount from each
// part; unique synthetic id e.g. `${txnId}:${splitId}`). Non-split transactions pass through
// unchanged. A parent flagged 'Split' but with no split rows (should not happen) passes through as-is.
export function explodeSplits(
  transactions: Transaction[],
  splits: TransactionSplit[],
): Transaction[]

// Sum of split magnitudes (absolute value), rounded to cents.
export function splitTotal(splits: TransactionSplit[]): number

// True when Σ|part| equals |parentAmount| within a 1-cent tolerance.
export function splitsMatchParent(parentAmount: number, splits: TransactionSplit[]): boolean
```

`explodeSplits` is the heart of the approach: rollups that receive its output count split parts by
category with **zero changes** to the rollup functions or their tests.

### 4. Fetch wiring (thin, per page)

Shared server helper `fetchSplitsFor(supabase, transactionIds): Promise<TransactionSplit[]>`
(returns `[]` for an empty id list). Then:

- **Dashboard** (`app/(app)/page.tsx`) and **Budgets** (`app/(app)/budgets/page.tsx`): fetch
  transactions exactly as today → `fetchSplitsFor(...)` → `explodeSplits(...)` → feed the existing
  rollups. Analysis now counts split parts.
- **Transactions** (`app/(app)/transactions/page.tsx`): fetch transactions + their splits, pass
  **both** to `TransactionsView`. Parent rows stay 1:1; splits are attached for display, filtering,
  and editing. (This page does **not** explode.)

The date ranges differ per page (month vs. trailing 12 months); each page owns its transaction query
and calls the shared `fetchSplitsFor` / `explodeSplits` — the helper stays a thin, range-agnostic
"given these transaction ids, return their splits."

### 5. UX — `/transactions` edit modal

- Category cell for a split transaction reads `"Split (N)"`; row remains a single line.
- The edit modal gains a **"Split transaction"** section:
  - Rows of *(category `<select>`, amount input)*, an **Add split** button, and a **Remove** button
    per row.
  - A live running total: **allocated vs. transaction amount**; save is blocked until they match.
  - **Remove split** reverts the parent to `Uncategorized` and deletes all parts.
- **Category filter**: selecting a category (e.g. *Groceries*) matches a split transaction if **any**
  of its parts is that category; a dedicated *Split* filter option matches parent `category === 'Split'`.
  Implemented client-side since splits are already attached to the view.
- Consistent with Plan 5a, the modal uses native `<select>`/inputs + the existing Tailwind modal
  (not shadcn Dialog/Select).

### 6. Server actions — `app/(app)/transactions/actions.ts`

`saveTransactionSplits(prev, formData)`:
- Auth: user resolved from session.
- Zod validation: owned transaction id; **≥ 2** parts; each part a valid `CATEGORIES` member with
  magnitude > 0; part magnitudes **sum exactly to `|parent amount|`** (1-cent tolerance via
  `splitsMatchParent`).
- Parts are signed to match the parent's sign.
- Execution (sequential Supabase ops, matching the codebase's no-RPC style): delete existing splits
  for the transaction → insert the new parts → update parent `category = 'Split'`. `revalidatePath('/transactions')`.
- **Trade-off noted:** these three ops are not wrapped in a DB transaction, so a mid-sequence failure
  could leave splits and the parent category briefly inconsistent. Acceptable for a single-user
  personal app; re-saving the split repairs it. (A Postgres RPC could make it atomic later if needed.)

`removeTransactionSplits(id)`: delete the transaction's split rows and set parent
`category = 'Uncategorized'`; `revalidatePath('/transactions')`.

### 7. Edge cases

- **Sticky sync already protects splits.** `app/api/sync` never overwrites `category` on `modified`,
  so a re-synced split transaction keeps `'Split'` and its parts; sync never touches
  `transaction_splits`.
- **Plaid changes a split transaction's amount.** Parts may no longer sum to the new amount. Nothing
  is auto-deleted; the edit modal shows a subtle **"split total ≠ transaction amount"** warning
  (via `splitsMatchParent`) so the user can re-split.
- **Plaid `removed`** transaction → `on delete cascade` removes its splits.

## Testing strategy

- **`lib/finance/split.test.ts`** (new): `explodeSplits` (zero / one / many splits, sign handling,
  synthetic-id uniqueness, non-split passthrough), `splitTotal`, `splitsMatchParent` (exact match,
  under, over, cent tolerance).
- **`app/(app)/transactions/actions.test.ts`** (extended): sum-mismatch rejected; `< 2` parts
  rejected; invalid category rejected; success sets parent `category = 'Split'` and inserts parts;
  `removeTransactionSplits` reverts to `Uncategorized`.
- **Existing budget/cashflow tests stay green untouched** — the proof that the reshaping is isolated
  to `explodeSplits` and the fetch wiring.

## Non-goals (YAGNI)

- No per-split notes (parts are category + amount only).
- No partial split with an implicit remainder — the full amount is always allocated.
- No split templates / suggested splits.
- No DB-transaction atomicity for the save (documented trade-off above).
- Net worth is unaffected (account-balance based).

## Files touched

- **New:** `supabase/migrations/0007_transaction_splits.sql`, `lib/finance/split.ts`,
  `lib/finance/split.test.ts`.
- **Modified:** `lib/finance/categories.ts` (`SPLIT_CATEGORY`), `lib/types.ts` (`TransactionSplit`),
  a shared `fetchSplitsFor` helper, `app/(app)/page.tsx`, `app/(app)/budgets/page.tsx`,
  `app/(app)/transactions/page.tsx`, `components/transactions/*` (view + edit modal, filters),
  `app/(app)/transactions/actions.ts` (+ `.test.ts`).
</content>
</invoke>
