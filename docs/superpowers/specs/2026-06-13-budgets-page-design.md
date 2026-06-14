# Budgets Page — Design (Plan 5b)

**Date:** 2026-06-13
**Status:** Approved design — ready for implementation planning (Plan 5b)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app), `2026-06-13-transactions-page-design.md` (Plan 5a — categories, month nav, action/UI patterns reused here).

## Overview

Plan 5b is the second slice of the decomposed Plan 5 (5a Transactions → **5b Budgets**
→ 5c Goals → 5d Bills → 5e Dashboard + cashflow charts). It adds a `/budgets`
page: per-category monthly budgets with progress bars showing the selected
month's spending against each limit, near/over color alerts, and create/edit/
delete. Most of the math already exists in `lib/finance/budget.ts` (Plan 3); 5b
is mostly UI + Server Actions, reusing the 5a patterns (controlled categories,
`?month=` navigation, native-select + Tailwind-modal forms).

### Goals
- One budget per category, enforced by a `unique (user_id, category)` constraint.
- Budgetable categories restricted to **spending** categories (the controlled
  list minus `Income` and `Transfer`).
- A month-scoped `/budgets` page (default current month, prev/next navigation):
  one row per budget with a progress bar of that month's spending vs. the limit,
  colored under/near/over.
- Create/edit/delete budgets via Zod-validated Server Actions (upsert on the
  unique key).

### Non-goals (deferred)
- **Multi-month comparison** (categories × months table, budget-trend charts) —
  Plan 5e. 5b shows one month at a time via navigation.
- Goals / Bills (5c / 5d), dashboard widgets / cashflow charts (5e).
- Rollover budgets, per-account budgets, budget templates — out of scope.

## Data model & categories

**Migration `0003_budget_unique.sql`** (applied via the Supabase SQL editor, like
`0001`/`0002`):
```sql
alter table budgets add constraint budgets_user_category_unique unique (user_id, category);
```
This enforces one budget per category and lets `saveBudget` upsert on conflict.
The `budgets` table otherwise unchanged (`id, user_id, category, monthly_limit`);
the `Budget` type is unchanged.

**`lib/finance/categories.ts` additions:**
- `SPENDING_CATEGORIES` — `CATEGORIES` minus `Income` and `Transfer` (i.e.
  Groceries, Food And Drink, Transportation, Travel, Shopping, Bills & Utilities,
  Entertainment, Health, Uncategorized).
- `isSpendingCategory(value): value is Category` — guard, mirroring `isCategory`.

## Budget math (`lib/finance/budget.ts`)

Reused unchanged: `spentThisMonth(transactions, category, year, month)` and
`budgetRemaining(monthlyLimit, spent)` (Plan 3, already tested).

One **addition** to keep the color logic pure and testable:
- `budgetStatus(spent: number, limit: number): 'under' | 'near' | 'over'` —
  `over` when `spent > limit` (>100%), `near` when `spent >= 0.8 * limit`
  (80–100%), else `under`. A non-positive limit returns `'over'` when any spend
  exists, else `'under'` (avoids divide-by-zero / nonsensical bars).

## Server Actions (`app/(app)/budgets/actions.ts`)

Same pattern as 5a: identity from the Supabase session, Zod validation,
`revalidatePath('/budgets')`, typed `{ error }` | `{ success: true }`.

- **`saveBudget(state, formData)`** — create or edit. Fields: `category` (must
  pass `isSpendingCategory`) and `monthly_limit` (coerced number, positive).
  Resolves `user_id` from session and **upserts on conflict `(user_id, category)`**
  — insert for a new category, update the limit for an existing one. On the edit
  form the category is submitted as a hidden field (fixed); create lets the user
  choose. No `is_manual`-style guard is needed (budgets are always user-owned).
- **`deleteBudget(id)`** — `.delete().eq('id', id)` (RLS scopes to the user).

## Page & UI

**`app/(app)/budgets/page.tsx`** (Server Component) — reads the target month from
`searchParams` (default current month via the 5a helper), computes `monthBounds`,
fetches the user's budgets and the selected month's transactions (RLS). For each
budget computes `spent = spentThisMonth(txns, category, year, month)`,
`remaining = budgetRemaining(limit, spent)`, and `status = budgetStatus(spent,
limit)`. Passes the assembled rows + month + the set of already-budgeted
categories to the client view.

**`components/budgets/budgets-view.tsx`** (client):
- **Toolbar:** prev/next month arrows + month label (reusing `shiftMonth` +
  `router.push('?month=')`). No category/account filters — budgets are per-category.
- **Each budget row (`Card`):** category name; a **progress bar** (width =
  `min(100, spent/limit*100)%`) colored by `status` (under → green/normal, near →
  amber, over → red); figures `"$spent of $limit"` and either `"$X left"` or
  `"$X over"` (`en-US` currency). Row click → edit modal.
- **"+ Add budget"** → create modal. **Empty state** when no budgets exist.

**`components/budgets/budget-form.tsx`** (client modal, same Tailwind-overlay
pattern as 5a) — `useActionState` on `saveBudget`; sonner toast + `router.refresh()`
on success.
- **Create:** category `<select>` listing `SPENDING_CATEGORIES` **not already
  budgeted** + a monthly-limit `<Input type="number">`.
- **Edit:** category shown read-only (hidden field submits it) + editable limit +
  a **Delete** button calling `deleteBudget`.

Reuses existing `Button`/`Card`/`Input` + native `<select>` + the modal pattern;
no new shadcn components.

## Error handling

- Server Actions validate with Zod → typed `{ error }` rendered inline / toasted.
- Supabase mutation errors → `{ error }` → sonner error toast.
- Failed reads in the page throw → route-segment `error.tsx` (Plan 3) with retry.
- No budgets → friendly empty state.

## Testing

Vitest; Supabase mocked (reuse `lib/plaid/test-helpers`). UI via build + manual smoke.

- **`lib/finance/categories.test.ts`** (extend) — `SPENDING_CATEGORIES` excludes
  `Income`/`Transfer`, includes the spending categories incl. `Uncategorized`;
  `isSpendingCategory` guard true/false cases.
- **`lib/finance/budget.test.ts`** (extend) — `budgetStatus`: 79%→under, 80%→near,
  100%→near, 101%→over, and a 0 limit (spend→over, no spend→under).
- **`app/(app)/budgets/actions.test.ts`** — `saveBudget` rejects a non-spending
  category (`Income`) and a non-positive limit; valid input calls `upsert` with
  `{ onConflict: 'user_id,category' }`. `deleteBudget` deletes by id.
- **Build/typecheck:** `npm run build` succeeds (`/budgets` listed); `npx tsc
  --noEmit` clean; full `npx vitest run` green.
- **Manual smoke test:** add a budget (e.g. Groceries $400) → progress bar
  reflects this month's Groceries spending with the right color; push spend near/
  over → amber/red; arrow to a prior month → `spent` recomputes (limit unchanged);
  edit the limit; delete the budget; confirm the create dropdown hides
  already-budgeted categories.

## Done criteria
- `npx vitest run` green (extended categories + budget tests, budgets actions, all
  prior suites).
- `npm run build` succeeds with `/budgets` rendering month-scoped budget rows.
- One budget per category enforced; only spending categories budgetable.
- Progress bars show the selected month's spend vs. limit with under/near/over
  colors; month navigation recomputes spend.
- Create/edit/delete work via the upsert action.
- No multi-month comparison, no goals/bills/dashboard — those are later plans.
