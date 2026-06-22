# Goals Page — Design (Plan 5c)

**Date:** 2026-06-21
**Status:** Approved design — ready for implementation planning (Plan 5c)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app), `2026-06-13-transactions-page-design.md` (Plan 5a — action/UI patterns), `2026-06-13-budgets-page-design.md` (Plan 5b — CRUD-dialog + pure-helper + Server-Action patterns reused here).

## Overview

Plan 5c is the third slice of the decomposed Plan 5 (5a Transactions → 5b Budgets
→ **5c Goals** → 5d Bills → 5e Dashboard + cashflow charts). It adds a `/goals`
page: standalone savings goals, each with a target amount, manually-tracked
progress, an icon + color for personality, and an optional target date with a
simple "save $X/month" pace hint. Unlike budgets/transactions, goals are **not
month-scoped** — each goal is an ongoing target you chip away at over time.
Progress is updated manually via an **"Add contribution"** action (and direct
edits); there is no coupling to accounts or transactions.

### Goals
- A `/goals` page listing the user's savings goals as cards, each with a progress
  bar (current vs. target) tinted with the goal's chosen color.
- Manual progress: an **"Add contribution"** action increments `current_amount`;
  the edit dialog can also set current/target directly.
- Each goal has an **icon** and **color** chosen from controlled preset lists.
- Optional **target date** drives a pure **monthly-pace hint**
  (`(target − current) ÷ months remaining`).
- Create/edit/delete goals via Zod-validated Server Actions.

### Non-goals (deferred)
- **Contribution history** — contributions only increment `current_amount`; no
  per-contribution rows. (Would need a table/migration; revisit later.)
- **Account linking** — mirroring a goal off an account's balance. The lighter of
  the two automation options (nullable `account_id` + "use balance" toggle); a
  possible small follow-up, not in 5c.
- **Transaction linking** — tagging transactions as contributions and summing
  them. Overlaps with contribution history; deferred.
- **Reminders/notifications, goal reordering, free-form icons/colors** — out.
- Bills (5d), dashboard widgets / cashflow charts (5e).

## Data model

**No migration needed.** The `goals` table already exists and the `Goal` type is
unchanged:
`id, user_id, name, target_amount, current_amount, target_date?, icon, color_hex`.
`current_amount` defaults to `0` on create. Goals are not required to be unique by
name (no constraint).

## Presets (`lib/finance/goal-presets.ts`)

Controlled lists, validated server-side (same spirit as `SPENDING_CATEGORIES`):
- `GOAL_ICONS` — a fixed 8-emoji set: `🏖️` (vacation), `🚗` (car), `🏠` (home),
  `🛟` (emergency fund), `🎓` (education), `🎁` (gift), `💍` (wedding), `💰` (generic).
- `GOAL_COLORS` — 6 hex swatches: `#16a34a` (green), `#2563eb` (blue), `#7c3aed`
  (violet), `#d97706` (amber), `#e11d48` (rose), `#475569` (slate).
- Guards `isGoalIcon(value)` / `isGoalColor(value)` for Zod `.refine`.

## Goal math (`lib/finance/goal.ts`) — pure, unit-tested

- `goalProgress(current, target): number` — percent `0–100`, **capped at 100**
  (overshoot still reads 100); a non-positive `target` returns `0` (avoids
  divide-by-zero / nonsensical bars).
- `goalReached(current, target): boolean` — `current >= target` (and `target > 0`).
- `monthlyPaceNeeded(current, target, targetDate, today): number | null` —
  remaining amount `(target − current)` divided by **whole months remaining**
  (min 1) between `today` and `targetDate`. Returns `null` when there is no
  target date or the goal is already reached. A target date in the past is
  treated as "due now" (1 month), so the hint shows the full remaining amount.
  `today`/`targetDate` are ISO `YYYY-MM-DD` strings; month math reuses the
  `lib/finance/month.ts` style (string parsing, no timezone surprises).

## Server Actions (`app/(app)/goals/actions.ts`)

Same pattern as 5a/5b: identity from the Supabase session, Zod validation,
`revalidatePath('/goals')`, typed `{ error }` | `{ success: true }`.

- **`saveGoal(state, formData)`** — create or edit, distinguished by a hidden
  `id` field. Fields: `name` (non-empty string), `target_amount` (coerced number,
  positive), `current_amount` (coerced number, `>= 0`; set on create, default 0),
  `target_date` (optional, ISO date or empty → `null`), `icon` (must pass
  `isGoalIcon`), `color_hex` (must pass `isGoalColor`). Resolves `user_id` from
  session; **insert** when no `id`, **update** (`.eq('id', id)`) when present.
- **`addContribution(id, amount)`** — validate `amount` positive; read the goal's
  `current_amount`, write `current + amount` (`.eq('id', id)`). Single-user app —
  the read-then-write race is acceptable and noted.
- **`deleteGoal(id)`** — `.delete().eq('id', id)` (RLS scopes to the user).

## Page & UI

**`app/(app)/goals/page.tsx`** (Server Component) — replaces the placeholder.
Fetches the user's goals ordered by `name` (RLS), passes them to the client view.
No `searchParams`/month handling (goals aren't month-scoped).

**`components/goals/goals-view.tsx`** (client):
- **Header:** title + **"+ Add goal"** button.
- **Each goal (`Card`):** the icon tinted with the goal's color; the name; a
  **progress bar** (width = `goalProgress(current, target)%`) whose fill color is
  the goal's `color_hex` applied via inline `style` (Tailwind can't emit dynamic
  hex classes); `"$current of $target (NN%)"` (`en-US` currency); and a status
  line — `"Reached 🎉"` when `goalReached`, else the **pace hint**
  `"Save ~$Y/mo to reach by <date>"` when a target date is set, else `"$X to go"`.
  An **"Add contribution"** button per card; clicking the card body opens edit.
- **Empty state** (reuse `EmptyState`) when no goals exist.

**`components/goals/goal-form.tsx`** (client modal, same Tailwind-overlay pattern
as 5a/5b) — `useActionState` on `saveGoal`; sonner toast + `router.refresh()` on
success.
- **Create:** name `<Input>`; target `<Input type="number">`; current
  `<Input type="number">` (defaults 0); target-date `<Input type="date">`
  (optional); **icon picker** (a grid of preset buttons, selected one highlighted,
  value submitted via hidden field) and **color picker** (a row of swatch buttons,
  same mechanism).
- **Edit:** same fields prefilled (name/target/current editable) + a **Delete**
  button calling `deleteGoal`.

**`components/goals/contribution-form.tsx`** (client modal) — a small dedicated
dialog (same Tailwind-overlay pattern) opened from a card's "Add contribution"
button: a single amount `<Input type="number">` + Save/Cancel. Calls
`addContribution(id, amount)` then `router.refresh()` + toast.

Reuses existing `Button`/`Card`/`Input` + the modal pattern; no new shadcn
components.

## Error handling

- Server Actions validate with Zod → typed `{ error }` rendered inline / toasted.
- Supabase mutation errors → `{ error }` → sonner error toast.
- Failed reads in the page throw → route-segment `error.tsx` (Plan 3) with retry.
- No goals → friendly empty state.

## Testing

Vitest; Supabase mocked (reuse `lib/plaid/test-helpers`). UI via build + manual smoke.

- **`lib/finance/goal.test.ts`** — `goalProgress` (0%, partial, 100% cap on
  overshoot, non-positive target → 0); `goalReached` boundaries; `monthlyPaceNeeded`
  (no date → null, reached → null, N months remaining → remaining ÷ N, past date →
  full remaining).
- **`lib/finance/goal-presets.test.ts`** — `isGoalIcon`/`isGoalColor` true for
  preset members, false for non-members.
- **`app/(app)/goals/actions.test.ts`** — `saveGoal` errors unauthenticated,
  rejects an empty name / non-positive target / invalid icon or color, inserts on
  create and updates on edit (id present); `addContribution` rejects non-positive
  amount and writes `current + amount`; `deleteGoal` deletes by id.
- **Build/typecheck:** `npm run build` succeeds (`/goals` listed); `npx tsc
  --noEmit` clean; full `npx vitest run` green.
- **Manual smoke test:** add a goal (e.g. "Vacation" $3,000, icon 🏖️, blue, target
  date) → card shows 0% bar in blue + pace hint; **Add contribution** $500 → bar
  fills to ~17%, hint recomputes; edit target/current; reach the target → "Reached
  🎉"; delete the goal; confirm icon/color render as chosen.

## Done criteria
- `npx vitest run` green (goal helpers, goal presets, goals actions, all prior suites).
- `npm run build` succeeds with `/goals` rendering goal cards.
- Manual progress works: "Add contribution" increments; edit sets values directly.
- Icon + color chosen from presets; progress bar tinted by the goal's color.
- Optional target date drives a monthly-pace hint; reached goals show "Reached".
- Create/edit/delete work via the Server Actions.
- No contribution history, no account/transaction linking, no bills/dashboard —
  those are later plans.
