# Transactions Page — Design (Plan 5a)

**Date:** 2026-06-13
**Status:** Approved design — ready for implementation planning (Plan 5a)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app), `2026-06-13-plaid-bank-sync-design.md` (Plaid sync, Plan 4).

## Overview

Plan 5 (the real feature pages) is **decomposed into focused sub-plans**, built in
order: **5a Transactions** → 5b Budgets → 5c Goals → 5d Bills → 5e Dashboard
widgets + cashflow charts. This spec covers **5a only**.

5a makes transactions visible and manageable. Today the `transactions` table is
populated by Plaid sync (Plan 4) but there's no UI. 5a delivers a month-scoped
transactions page: a filterable list, the ability to **re-categorize and
annotate** any transaction (including synced ones), and full **manual** entry for
cash/corrections. It also introduces a **controlled category list** that the
whole app (budgets, charts) will share, and adjusts the Plan 4 sync so user
category edits are never overwritten.

### Goals
- A controlled category vocabulary (`lib/finance/categories.ts`) used by every
  category dropdown, with Plaid's categories mapped onto it during sync.
- Month-scoped transactions list (default current month, prev/next navigation)
  with client-side filters: account, category, and merchant text search.
- Edit any transaction's **category + notes**; full create/edit/delete for
  **manual** transactions; synced transactions are protected (category/notes only).
- User category edits **persist across future syncs** (sticky category).
- Server Actions (Zod-validated, session/RLS) for manual save, category/notes
  update, and manual delete.

### Non-goals (deferred)
- **Transaction splitting** (one transaction across multiple categories) —
  parked as a later enhancement; it needs a child `transaction_splits` table and
  changes every category rollup (budgets, charts). The single-`category` column
  is forward-compatible with adding it later.
- **Dashboard widgets and cashflow charts** — Plan 5e.
- **Budgets / goals / bills** pages — Plans 5b–5d.
- Rich filtering (free date-range, multi-select, amount ranges), pagination/
  infinite scroll — month scoping makes these unnecessary for v1.

## Category model

`lib/finance/categories.ts` (pure, unit-tested):
- `CATEGORIES` — the canonical const array. Starter set: `Income`, `Groceries`,
  `Food And Drink`, `Transportation`, `Travel`, `Shopping`, `Bills & Utilities`,
  `Entertainment`, `Health`, `Transfer`, `Uncategorized`.
- `Category` — union type derived from `CATEGORIES`.
- `mapPlaidCategory(plaidPrimary: string | null | undefined): Category` — maps
  Plaid `personal_finance_category.primary` onto the list; unknown/empty →
  `Uncategorized`. The output is always a member of `CATEGORIES`.

This **replaces `titleCaseCategory`** in the Plan 4 mapper (`lib/plaid/map.ts`),
so synced transactions use the same vocabulary the UI dropdowns offer.

## Sticky category (preserving user edits)

Plan 4's sync upserts each transaction with the Plaid-derived category, which
would overwrite a user's re-categorization when a transaction reappears in a
`modified` batch (common as pending charges settle). The fix is a behavior change
in `app/api/sync/route.ts`, **no new column or migration**:

- **`added`** (new transactions): insert with the mapped Plaid category as today.
- **`modified`** (existing transactions): update `amount`, `date`,
  `merchant_name`, `account_id` — **but not `category`**.

Net effect: a transaction's category is set once (by Plaid on insert, or by the
user on edit) and **no later sync overwrites it**. Accepted tradeoff: if Plaid
improves its own categorization on an un-edited settling transaction, we keep the
original (categories are "sticky" after insert) — predictable and simpler than a
`category_overridden` flag.

## Schema

**No migration.** `transactions` already has `category`, `notes`, `is_manual`,
`account_id`, `plaid_transaction_id` (from `0001` + `0002`). 5a is purely UI +
Server Actions + the categories module + the sync tweak.

## Server Actions (`app/(app)/transactions/actions.ts`)

All resolve the user from the Supabase session (RLS-enforced), validate with Zod,
`revalidatePath('/transactions')` on success, and return typed `{ error }` |
success — following `app/auth/actions.ts`.

- **`saveManualTransaction(state, formData)`** — create/update a **manual**
  transaction. Fields: `date`, `merchant_name`, `category` (∈ `CATEGORIES`),
  `amount` (positive number) + a **type** toggle (`expense` | `income`)
  determining the stored sign (expense → negative, income → positive),
  `account_id` (optional), `notes` (optional). Sets `is_manual: true`, `user_id`
  from session. Update path is scoped `.eq('is_manual', true)` so it can only
  touch manual rows.
- **`updateTransactionCategory(id, { category, notes })`** — for **any**
  transaction. Updates only `category` (∈ `CATEGORIES`) and `notes`; never
  amount/date/merchant. This is the "tap to edit" path; with sticky-category sync,
  the edit persists.
- **`deleteManualTransaction(id)`** — `.delete().eq('id', id).eq('is_manual',
  true)`. A synced row won't match, so hand-deletion of Plaid transactions is
  impossible (sync owns them).

**Security:** the `.eq('is_manual', true)` filter on the manual-only operations,
combined with RLS (own rows only), is the guard — a user can re-categorize/
annotate a synced transaction but cannot full-edit or delete it. No separate
ownership check needed.

## Page & UI

**`app/(app)/transactions/page.tsx`** (Server Component) — reads the target month
from `searchParams` (default current month); fetches that month's transactions
for the user (RLS, ordered by `date desc`) and the user's accounts (for the
filter + account names); passes both to the client view. Month scoping bounds row
count — no pagination.

**`components/transactions/transactions-view.tsx`** (client) — owns filter state;
renders toolbar + list + form. Props: the month's transactions + accounts.
- **Toolbar:** prev/next **month** nav (updates `?month=` → server refetch); plus
  **account** select, **category** select, **merchant search** — these filter the
  loaded month rows **client-side** (no refetch). Only month nav hits the server.
- **List:** one row per transaction — date · merchant · category badge · account
  name · amount (right-aligned, red if negative/expense, green if positive/income,
  `en-US` currency). A "manual" tag marks hand-entered rows. Row click → edit
  dialog. An **"+ Add transaction"** button opens the dialog in create mode.
- **Empty state:** `EmptyState` prompt when the month has no transactions.

**`components/transactions/transaction-form.tsx`** (client `Dialog`) — drives the
Server Actions via `useActionState`, with sonner toasts.
- **Manual transaction:** all fields editable — date, merchant, category
  (dropdown from `CATEGORIES`), amount + Expense/Income toggle, account (optional
  dropdown), notes — plus **Delete**.
- **Synced transaction:** amount/date/merchant **read-only**; only category
  (dropdown) and notes editable; no delete.

Uses existing primitives (shadcn `Dialog`, `Card`, `Input`, `Button`, `Select`,
sonner) and the Plan 3 `(app)` shell.

## Error handling

- Server Actions validate with Zod → typed `{ error }` rendered inline / toasted.
- Supabase mutation errors → `{ error }` → sonner error toast.
- Failed reads in the page (Server Component) throw → caught by the route-segment
  `error.tsx` (Plan 3) with retry.
- Empty month → friendly empty state, not a blank table.

## Testing

Vitest; Supabase mocked (reuse `lib/plaid/test-helpers`). UI verified via build +
manual smoke test.

- **`lib/finance/categories.test.ts`** — `mapPlaidCategory` maps known Plaid
  primaries correctly (`FOOD_AND_DRINK → Food And Drink`, etc.), unknown/empty →
  `Uncategorized`, and every output ∈ `CATEGORIES`.
- **`app/(app)/transactions/actions.test.ts`** — the three actions:
  `saveManualTransaction` (Zod rejects missing merchant / amount ≤ 0 / category
  not in list; expense stores negative, income positive; `is_manual: true`);
  `updateTransactionCategory` (updates category+notes only; rejects bad category);
  `deleteManualTransaction` (delete filtered by `is_manual = true`).
- **Plan 4 regression:** update `lib/plaid/map.test.ts` for `mapPlaidCategory`
  (replacing `titleCaseCategory`); update `app/api/sync/route.test.ts` to assert
  the sticky-category change (`added` writes category; `modified` updates
  amount/date/merchant but not category).
- **Build/typecheck:** `npm run build` succeeds; `npx tsc --noEmit` clean; full
  `npx vitest run` green.
- **Manual smoke test:** add a manual expense (negative, red) and income
  (positive, green); re-categorize a synced transaction and confirm it sticks
  after another **Sync now**; use month nav + account/category/search filters;
  delete a manual transaction; confirm a synced row offers no delete and read-only
  amount/date/merchant.

## Done criteria
- `npx vitest run` green (categories, transactions actions, updated Plan 4 map +
  sync suites, all prior suites).
- `npm run build` succeeds with `/transactions` rendering the list.
- A controlled category list backs every category dropdown; synced transactions
  use it (Plaid mapped onto it).
- Manual transactions: full create/edit/delete with correct amount signs.
- Any transaction can be re-categorized/annotated; synced transactions cannot be
  full-edited or deleted; user category edits survive a subsequent sync.
- No splitting, no dashboard/charts, no budgets/goals/bills — those are later plans.
