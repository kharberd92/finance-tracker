# Web App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable, authenticated Next.js App Router shell for the Personal Finance Tracker — schema + RLS, magic-link auth, app navigation, a unit-tested pure finance-logic library, and empty-state placeholder pages for all routes.

**Architecture:** A single Next.js (TypeScript) project in `finance-tracker/web/`. Reads happen in React Server Components via a server-side Supabase client (RLS enforced by the user session); mutations will be Server Actions (Zod-validated) in later plans. Auth is Supabase magic link, guarded by both Next.js middleware (coarse redirect) and the `(app)` route-group layout (`getUser()` re-check). Pure money math lives in `lib/finance/` with no Supabase/React dependency, so it is unit-testable in isolation.

**Tech Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · `@supabase/ssr` · Zod · Vitest

**Scope note:** This is Plan 3 (foundation). Plaid Route Handlers and bank sync are **Plan 4**. The real feature pages (transactions, budgets, goals, bills, dashboard widgets) and their Server Actions are **Plan 5**. The pages created here are auth-guarded placeholders with empty states.

**Known deferral (carry into Plan 5):** The approved schema stores only `due_day` + `frequency` for bills. That determines the next due date for `weekly` (day-of-week) and `monthly` (day-of-month) bills exactly. `quarterly`/`yearly` need an anchor month the schema lacks, so this plan implements weekly + monthly precisely and `nextDueDate` returns `null` for quarterly/yearly with a `// TODO(plan5)` marker. A later plan adds an anchor field (or derives it from Plaid recurring data).

---

### Task 1: Scaffold the Next.js project

**Files:**
- Create: `finance-tracker/web/` (Next.js project)
- Create: `finance-tracker/web/.env.local.example`
- Create: `finance-tracker/web/vitest.config.ts`
- Create: `finance-tracker/web/vitest.setup.ts`
- Modify: `finance-tracker/web/package.json` (add scripts/deps)

- [ ] **Step 1: Create the app**

Run from `finance-tracker/`:

```bash
cd finance-tracker
npx create-next-app@latest web --ts --tailwind --eslint --app --src-dir=false --import-alias "@/*" --no-turbopack
```

Accept defaults for any remaining prompts. Expected: a `web/` directory with `app/`, `tailwind.config.ts`, `tsconfig.json`, `package.json`.

- [ ] **Step 2: Install runtime + test dependencies**

Run:

```bash
cd finance-tracker/web
npm install @supabase/ssr @supabase/supabase-js zod
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Initialize shadcn/ui**

Run:

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input sonner
```

Expected: a `components/ui/` directory containing `button.tsx`, `card.tsx`, `input.tsx`, `sonner.tsx`, and a generated `components.json`.

- [ ] **Step 4: Add Vitest config**

Create `finance-tracker/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

Create `finance-tracker/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Add the test script**

In `finance-tracker/web/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 6: Add the env example**

Create `finance-tracker/web/.env.local.example`:

```bash
# Supabase — from the Supabase project dashboard (Settings → API)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
# Public site URL used for magic-link redirects
NEXT_PUBLIC_SITE_URL=http://localhost:3000
# Plaid — used in Plan 4 (kept here so .env.local is complete)
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
```

- [ ] **Step 7: Verify the app builds and tests run**

Run:

```bash
npm run build
npx vitest run
```

Expected: build succeeds. Vitest prints "No test files found" (exit 0) — acceptable; tests arrive in Task 3.

- [ ] **Step 8: Commit**

```bash
git add finance-tracker/web
git commit -m "feat(web): scaffold Next.js app with Tailwind, shadcn/ui, Vitest"
```

---

### Task 2: Shared domain types

**Files:**
- Create: `finance-tracker/web/lib/types.ts`

- [ ] **Step 1: Write the types**

Create `finance-tracker/web/lib/types.ts`:

```ts
export type AccountType = 'checking' | 'savings' | 'credit' | 'investment'

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  current_balance: number
  institution_name: string
  plaid_account_id?: string | null
  encrypted_plaid_access_token?: string | null
}

export interface Transaction {
  id: string
  user_id: string
  account_id?: string | null
  amount: number // negative = expense, positive = income
  date: string // ISO 'YYYY-MM-DD'
  merchant_name: string
  category: string
  notes?: string | null
  is_manual: boolean
}

export interface Budget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
}

export type BillFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Bill {
  id: string
  user_id: string
  name: string
  amount: number
  due_day: number // monthly/quarterly/yearly: day-of-month 1–31; weekly: day-of-week 0–6 (Sun=0)
  frequency: BillFrequency
  category: string
  is_paid: boolean
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date?: string | null
  icon: string
  color_hex: string
}
```

- [ ] **Step 2: Verify it type-checks**

Run:

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/lib/types.ts
git commit -m "feat(web): add shared domain types"
```

---

### Task 3: Finance logic — net worth (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/net-worth.ts`
- Test: `finance-tracker/web/lib/finance/net-worth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/net-worth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { netWorth } from './net-worth'
import type { Account } from '@/lib/types'

function acct(partial: Partial<Account>): Account {
  return {
    id: 'a', user_id: 'u', name: 'x', type: 'checking',
    current_balance: 0, institution_name: 'bank', ...partial,
  }
}

describe('netWorth', () => {
  it('returns 0 for no accounts', () => {
    expect(netWorth([])).toBe(0)
  })

  it('sums asset balances (checking, savings, investment)', () => {
    const accounts = [
      acct({ type: 'checking', current_balance: 1000 }),
      acct({ type: 'savings', current_balance: 5000 }),
      acct({ type: 'investment', current_balance: 20000 }),
    ]
    expect(netWorth(accounts)).toBe(26000)
  })

  it('subtracts credit (liability) balances', () => {
    const accounts = [
      acct({ type: 'checking', current_balance: 1000 }),
      acct({ type: 'credit', current_balance: 300 }),
    ]
    expect(netWorth(accounts)).toBe(700)
  })

  it('handles a mix to a negative net worth', () => {
    const accounts = [
      acct({ type: 'savings', current_balance: 200 }),
      acct({ type: 'credit', current_balance: 1500 }),
    ]
    expect(netWorth(accounts)).toBe(-1300)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/net-worth.test.ts`
Expected: FAIL — cannot find module `./net-worth`.

- [ ] **Step 3: Write the minimal implementation**

Create `finance-tracker/web/lib/finance/net-worth.ts`:

```ts
import type { Account, AccountType } from '@/lib/types'

const LIABILITY_TYPES: AccountType[] = ['credit']

/** Net worth = sum of asset balances minus sum of liability balances. */
export function netWorth(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) =>
      LIABILITY_TYPES.includes(a.type)
        ? sum - a.current_balance
        : sum + a.current_balance,
    0,
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/net-worth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/net-worth.ts finance-tracker/web/lib/finance/net-worth.test.ts
git commit -m "feat(web): add net-worth calculation"
```

---

### Task 4: Finance logic — budget rollups (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/budget.ts`
- Test: `finance-tracker/web/lib/finance/budget.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/budget.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { spentThisMonth, budgetRemaining } from './budget'
import type { Transaction } from '@/lib/types'

function txn(partial: Partial<Transaction>): Transaction {
  return {
    id: 't', user_id: 'u', amount: 0, date: '2026-06-15',
    merchant_name: 'm', category: 'Groceries', is_manual: false, ...partial,
  }
}

describe('spentThisMonth', () => {
  it('sums absolute value of expenses in the category and month', () => {
    const txns = [
      txn({ category: 'Groceries', amount: -40, date: '2026-06-02' }),
      txn({ category: 'Groceries', amount: -60, date: '2026-06-20' }),
    ]
    expect(spentThisMonth(txns, 'Groceries', 2026, 6)).toBe(100)
  })

  it('ignores other categories, other months, and income', () => {
    const txns = [
      txn({ category: 'Groceries', amount: -40, date: '2026-06-02' }),
      txn({ category: 'Dining', amount: -25, date: '2026-06-02' }),   // other category
      txn({ category: 'Groceries', amount: -99, date: '2026-05-30' }), // other month
      txn({ category: 'Groceries', amount: 500, date: '2026-06-01' }), // income (positive)
    ]
    expect(spentThisMonth(txns, 'Groceries', 2026, 6)).toBe(40)
  })

  it('returns 0 when nothing matches', () => {
    expect(spentThisMonth([], 'Groceries', 2026, 6)).toBe(0)
  })
})

describe('budgetRemaining', () => {
  it('returns limit minus spent', () => {
    expect(budgetRemaining(500, 120)).toBe(380)
  })

  it('can go negative when over budget', () => {
    expect(budgetRemaining(100, 150)).toBe(-50)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/budget.test.ts`
Expected: FAIL — cannot find module `./budget`.

- [ ] **Step 3: Write the minimal implementation**

Create `finance-tracker/web/lib/finance/budget.ts`:

```ts
import type { Transaction } from '@/lib/types'

/** True if an ISO 'YYYY-MM-DD' date falls in the given year and 1-based month. */
function isInMonth(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split('-').map(Number)
  return y === year && m === month
}

/** Total spent (positive number) in a category for a given year/month. Expenses are negative amounts. */
export function spentThisMonth(
  transactions: Transaction[],
  category: string,
  year: number,
  month: number,
): number {
  return transactions
    .filter(
      (t) =>
        t.category === category &&
        t.amount < 0 &&
        isInMonth(t.date, year, month),
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0)
}

/** Remaining budget; negative means over budget. */
export function budgetRemaining(monthlyLimit: number, spent: number): number {
  return monthlyLimit - spent
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/budget.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/budget.ts finance-tracker/web/lib/finance/budget.test.ts
git commit -m "feat(web): add budget spent/remaining rollups"
```

---

### Task 5: Finance logic — goal progress & projection (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/goal.ts`
- Test: `finance-tracker/web/lib/finance/goal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/goal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { goalProgress, monthsToGoal } from './goal'
import type { Goal } from '@/lib/types'

function goal(partial: Partial<Goal>): Goal {
  return {
    id: 'g', user_id: 'u', name: 'Emergency Fund',
    target_amount: 1000, current_amount: 0,
    icon: 'piggy', color_hex: '#16a34a', ...partial,
  }
}

describe('goalProgress', () => {
  it('returns a 0..1 fraction', () => {
    expect(goalProgress(goal({ target_amount: 1000, current_amount: 250 }))).toBe(0.25)
  })

  it('clamps to 1 when over-funded', () => {
    expect(goalProgress(goal({ target_amount: 1000, current_amount: 1500 }))).toBe(1)
  })

  it('returns 0 when target is 0 (avoids divide-by-zero)', () => {
    expect(goalProgress(goal({ target_amount: 0, current_amount: 100 }))).toBe(0)
  })
})

describe('monthsToGoal', () => {
  it('returns months remaining, rounded up', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 250 }), 100)).toBe(8)
  })

  it('returns 0 when already met', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 1000 }), 100)).toBe(0)
  })

  it('returns null when contribution is 0 or negative (never completes)', () => {
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 0 }), 0)).toBeNull()
    expect(monthsToGoal(goal({ target_amount: 1000, current_amount: 0 }), -50)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/goal.test.ts`
Expected: FAIL — cannot find module `./goal`.

- [ ] **Step 3: Write the minimal implementation**

Create `finance-tracker/web/lib/finance/goal.ts`:

```ts
import type { Goal } from '@/lib/types'

/** Progress as a 0..1 fraction, clamped. Returns 0 for a non-positive target. */
export function goalProgress(goal: Goal): number {
  if (goal.target_amount <= 0) return 0
  return Math.min(1, goal.current_amount / goal.target_amount)
}

/**
 * Whole months until the goal is met at a fixed monthly contribution.
 * 0 if already met; null if the contribution can never complete it.
 */
export function monthsToGoal(goal: Goal, monthlyContribution: number): number | null {
  if (goal.current_amount >= goal.target_amount) return 0
  if (monthlyContribution <= 0) return null
  return Math.ceil((goal.target_amount - goal.current_amount) / monthlyContribution)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/goal.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/finance/goal.ts finance-tracker/web/lib/finance/goal.test.ts
git commit -m "feat(web): add goal progress and projection"
```

---

### Task 6: Finance logic — bill next-due-date (TDD)

**Files:**
- Create: `finance-tracker/web/lib/finance/bill.ts`
- Test: `finance-tracker/web/lib/finance/bill.test.ts`

**Note:** Implements `weekly` (due_day = day-of-week) and `monthly` (due_day = day-of-month) exactly. `quarterly`/`yearly` return `null` pending a schema anchor (see plan header deferral). All date math uses UTC to stay deterministic across machines.

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/finance/bill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nextDueDate, daysUntilDue } from './bill'
import type { Bill } from '@/lib/types'

function bill(partial: Partial<Bill>): Bill {
  return {
    id: 'b', user_id: 'u', name: 'Rent', amount: 1200,
    due_day: 1, frequency: 'monthly', category: 'Housing',
    is_paid: false, ...partial,
  }
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('nextDueDate (monthly)', () => {
  it('returns the due_day later this month when it is still ahead', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 15 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-15')
  })

  it('rolls into next month when the due_day has passed', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-07-05')
  })

  it('treats the due_day itself as due today', () => {
    const due = nextDueDate(bill({ frequency: 'monthly', due_day: 10 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-10')
  })
})

describe('nextDueDate (weekly)', () => {
  it('returns the next occurrence of the weekday (Sun=0)', () => {
    // 2026-06-10 is a Wednesday (day 3); next Friday (day 5) is 2026-06-12
    const due = nextDueDate(bill({ frequency: 'weekly', due_day: 5 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-12')
  })

  it('returns today when the weekday matches', () => {
    // 2026-06-10 is a Wednesday (day 3)
    const due = nextDueDate(bill({ frequency: 'weekly', due_day: 3 }), d('2026-06-10'))
    expect(due?.toISOString().slice(0, 10)).toBe('2026-06-10')
  })
})

describe('nextDueDate (deferred frequencies)', () => {
  it('returns null for quarterly and yearly (pending schema anchor)', () => {
    expect(nextDueDate(bill({ frequency: 'quarterly' }), d('2026-06-10'))).toBeNull()
    expect(nextDueDate(bill({ frequency: 'yearly' }), d('2026-06-10'))).toBeNull()
  })
})

describe('daysUntilDue', () => {
  it('counts whole days to the next due date', () => {
    expect(daysUntilDue(bill({ frequency: 'monthly', due_day: 15 }), d('2026-06-10'))).toBe(5)
  })

  it('returns 0 when due today', () => {
    expect(daysUntilDue(bill({ frequency: 'monthly', due_day: 10 }), d('2026-06-10'))).toBe(0)
  })

  it('returns null when the next due date is undefined', () => {
    expect(daysUntilDue(bill({ frequency: 'yearly' }), d('2026-06-10'))).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: FAIL — cannot find module `./bill`.

- [ ] **Step 3: Write the minimal implementation**

Create `finance-tracker/web/lib/finance/bill.ts`:

```ts
import type { Bill } from '@/lib/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Midnight-UTC copy of a date (strips any time component). */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/**
 * The next date a bill is due on or after `from`.
 * - monthly: `due_day` is day-of-month (1–31)
 * - weekly:  `due_day` is day-of-week (Sun=0 … Sat=6)
 * - quarterly/yearly: null (no anchor month in the current schema — see Plan 5)
 */
export function nextDueDate(bill: Bill, from: Date): Date | null {
  const today = atUtcMidnight(from)

  if (bill.frequency === 'monthly') {
    const candidate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), bill.due_day),
    )
    if (candidate >= today) return candidate
    return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, bill.due_day))
  }

  if (bill.frequency === 'weekly') {
    const delta = (bill.due_day - today.getUTCDay() + 7) % 7
    return new Date(today.getTime() + delta * MS_PER_DAY)
  }

  // quarterly / yearly — deferred to Plan 5
  return null
}

/** Whole days from `from` until the bill's next due date, or null if undefined. */
export function daysUntilDue(bill: Bill, from: Date): number | null {
  const due = nextDueDate(bill, from)
  if (!due) return null
  return Math.round((due.getTime() - atUtcMidnight(from).getTime()) / MS_PER_DAY)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/bill.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the whole finance suite**

Run: `npx vitest run`
Expected: PASS — all finance tests green (24 tests total across Tasks 3–6).

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/lib/finance/bill.ts finance-tracker/web/lib/finance/bill.test.ts
git commit -m "feat(web): add bill next-due-date logic (weekly/monthly)"
```

---

### Task 7: Supabase schema & RLS migration

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0001_init.sql`:

```sql
-- Personal Finance Tracker — initial schema with Row Level Security.
-- Every table is scoped to the authenticated user via user_id.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings', 'credit', 'investment')),
  current_balance numeric not null default 0,
  institution_name text not null,
  plaid_account_id text,
  encrypted_plaid_access_token text,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references accounts (id) on delete set null,
  amount numeric not null,                 -- negative = expense, positive = income
  date date not null,
  merchant_name text not null,
  category text not null,
  notes text,
  is_manual boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  monthly_limit numeric not null
);

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric not null,
  due_day integer not null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  category text not null,
  is_paid boolean not null default false
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  target_date date,
  icon text not null default 'target',
  color_hex text not null default '#16a34a'
);

-- Indexes for the common per-user queries.
create index if not exists idx_accounts_user on accounts (user_id);
create index if not exists idx_transactions_user_date on transactions (user_id, date desc);
create index if not exists idx_budgets_user on budgets (user_id);
create index if not exists idx_bills_user on bills (user_id);
create index if not exists idx_goals_user on goals (user_id);

-- Row Level Security: a user can only see and modify their own rows.
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table budgets enable row level security;
alter table bills enable row level security;
alter table goals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'transactions', 'budgets', 'bills', 'goals']
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t || '_owner', t
    );
  end loop;
end $$;
```

- [ ] **Step 2: Verify the SQL is well-formed**

This migration is applied via the Supabase dashboard SQL editor or `supabase db push`. There is no automated test in this plan; correctness is checked by applying it to the project. Read the file once more and confirm each table has: `user_id` FK with `on delete cascade`, RLS enabled, and an owner policy.

Manual apply (when a Supabase project exists):

```bash
# Option A: paste 0001_init.sql into the Supabase dashboard SQL editor and run.
# Option B (with the Supabase CLI linked to the project):
#   supabase db push
```

Expected: five tables created, RLS enabled, five `*_owner` policies present.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/supabase/migrations/0001_init.sql
git commit -m "feat(web): add Supabase schema and RLS migration"
```

---

### Task 8: Supabase clients & session middleware

**Files:**
- Create: `finance-tracker/web/lib/supabase/server.ts`
- Create: `finance-tracker/web/lib/supabase/client.ts`
- Create: `finance-tracker/web/lib/supabase/middleware.ts`
- Create: `finance-tracker/web/middleware.ts`

- [ ] **Step 1: Server client**

Create `finance-tracker/web/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Supabase client for Server Components / Route Handlers / Server Actions. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component (read-only cookies). Safe to ignore:
            // middleware refreshes the session.
          }
        },
      },
    },
  )
}
```

- [ ] **Step 2: Browser client**

Create `finance-tracker/web/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'

/** Supabase client for Client Components (e.g. the future Plaid Link button). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 3: Middleware session helper**

Create `finance-tracker/web/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PREFIXES = ['/login', '/auth']

/** Refreshes the Supabase session cookie and redirects unauthenticated users to /login. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return response
}
```

- [ ] **Step 4: Root middleware**

Create `finance-tracker/web/middleware.ts`:

```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 5: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/lib/supabase finance-tracker/web/middleware.ts
git commit -m "feat(web): add Supabase clients and session middleware"
```

---

### Task 9: Auth — actions, login page, callback

**Files:**
- Create: `finance-tracker/web/app/auth/actions.ts`
- Create: `finance-tracker/web/app/login/page.tsx`
- Create: `finance-tracker/web/app/auth/callback/route.ts`

- [ ] **Step 1: Auth server actions**

Create `finance-tracker/web/app/auth/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const emailSchema = z.object({ email: z.string().email() })

export type AuthState = { error?: string; success?: boolean }

export async function signInWithMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    return { error: 'Please enter a valid email address.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) return { error: error.message }
  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
```

- [ ] **Step 2: Login page**

Create `finance-tracker/web/app/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { signInWithMagicLink, type AuthState } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

const initialState: AuthState = {}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInWithMagicLink, initialState)

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ll email you a magic link — no password needed.
          </p>
        </div>

        {state.success ? (
          <p className="text-sm" role="status">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form action={formAction} className="space-y-3">
            <Input
              type="email"
              name="email"
              placeholder="you@example.com"
              required
              aria-label="Email address"
            />
            {state.error && (
              <p className="text-sm text-red-600" role="alert">
                {state.error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}
      </Card>
    </main>
  )
}
```

- [ ] **Step 3: Callback route handler**

Create `finance-tracker/web/app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}/`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`)
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds; `/login` and `/auth/callback` appear in the route list.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/auth finance-tracker/web/app/login
git commit -m "feat(web): add magic-link auth actions, login page, and callback"
```

---

### Task 10: App shell — root layout, top nav, guarded `(app)` layout, error boundaries

**Files:**
- Modify: `finance-tracker/web/app/layout.tsx`
- Create: `finance-tracker/web/components/nav/top-nav.tsx`
- Create: `finance-tracker/web/app/(app)/layout.tsx`
- Create: `finance-tracker/web/app/error.tsx`
- Create: `finance-tracker/web/app/not-found.tsx`

- [ ] **Step 1: Root layout with Toaster**

Replace the body of `finance-tracker/web/app/layout.tsx` with:

```tsx
import type { Metadata } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'Finance Tracker',
  description: 'Personal finance tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Top navigation**

Create `finance-tracker/web/components/nav/top-nav.tsx`:

```tsx
import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/goals', label: 'Goals' },
  { href: '/bills', label: 'Bills' },
  { href: '/accounts', label: 'Accounts' },
]

export function TopNav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-5xl items-center gap-4 p-4">
        <span className="font-semibold">💰 Finance Tracker</span>
        <ul className="flex flex-1 gap-3 text-sm">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="text-muted-foreground hover:text-foreground">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
          Settings
        </Link>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </nav>
    </header>
  )
}
```

- [ ] **Step 3: Guarded `(app)` layout**

Create `finance-tracker/web/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/nav/top-nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Defense in depth: middleware also redirects, but never render app chrome
  // without a verified user.
  if (!user) redirect('/login')

  return (
    <div>
      <TopNav />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  )
}
```

- [ ] **Step 4: Root error boundary**

Create `finance-tracker/web/app/error.tsx`:

```tsx
'use client'

import { Button } from '@/components/ui/button'

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred. Try again.
      </p>
      <Button onClick={() => reset()}>Retry</Button>
    </main>
  )
}
```

- [ ] **Step 5: Not-found boundary**

Create `finance-tracker/web/app/not-found.tsx`:

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Button asChild>
        <Link href="/">Back to dashboard</Link>
      </Button>
    </main>
  )
}
```

- [ ] **Step 6: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (Routes inside `(app)` arrive in Task 11; the build may warn that `(app)` has a layout but no page until then — that is fine, or proceed directly to Task 11 before building.)

- [ ] **Step 7: Commit**

```bash
git add finance-tracker/web/app/layout.tsx finance-tracker/web/components/nav finance-tracker/web/app/\(app\)/layout.tsx finance-tracker/web/app/error.tsx finance-tracker/web/app/not-found.tsx
git commit -m "feat(web): add app shell, top nav, guarded layout, error boundaries"
```

---

### Task 11: Placeholder feature pages with empty states

**Files:**
- Create: `finance-tracker/web/app/(app)/page.tsx` (Dashboard)
- Create: `finance-tracker/web/app/(app)/transactions/page.tsx`
- Create: `finance-tracker/web/app/(app)/budgets/page.tsx`
- Create: `finance-tracker/web/app/(app)/goals/page.tsx`
- Create: `finance-tracker/web/app/(app)/bills/page.tsx`
- Create: `finance-tracker/web/app/(app)/accounts/page.tsx`
- Create: `finance-tracker/web/app/(app)/settings/page.tsx`
- Create: `finance-tracker/web/components/empty-state.tsx`

- [ ] **Step 1: Shared empty-state component**

Create `finance-tracker/web/components/empty-state.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </Card>
  )
}
```

- [ ] **Step 2: Dashboard page**

Create `finance-tracker/web/app/(app)/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { netWorth } from '@/lib/finance/net-worth'
import { Card } from '@/components/ui/card'
import type { Account } from '@/lib/types'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('accounts').select('*')
  const accounts = (data ?? []) as Account[]
  const total = netWorth(accounts)

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center">
        <p className="text-xs uppercase text-muted-foreground">Net worth</p>
        <p className="text-3xl font-bold">
          {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
        </p>
      </Card>

      {/* Widget grid — real widgets land in Plan 5. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {['Spent vs. budget', 'Goals progress', 'Upcoming bills', 'Recent transactions'].map(
          (label) => (
            <Card key={label} className="p-6">
              <p className="font-medium">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">Coming soon.</p>
            </Card>
          ),
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: The five list pages**

Create each file below with the shown content.

`finance-tracker/web/app/(app)/transactions/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

export default function TransactionsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Transactions</h1>
      <EmptyState
        title="No transactions yet"
        hint="Connect a bank or add a manual transaction to get started."
      />
    </section>
  )
}
```

`finance-tracker/web/app/(app)/budgets/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

export default function BudgetsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Budgets</h1>
      <EmptyState title="No budgets yet" hint="Create a category budget to track your spending." />
    </section>
  )
}
```

`finance-tracker/web/app/(app)/goals/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

export default function GoalsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Goals</h1>
      <EmptyState title="No goals yet" hint="Set a savings goal and track your progress." />
    </section>
  )
}
```

`finance-tracker/web/app/(app)/bills/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

export default function BillsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Bills</h1>
      <EmptyState title="No bills yet" hint="Add a recurring bill to see what's due and when." />
    </section>
  )
}
```

`finance-tracker/web/app/(app)/accounts/page.tsx`:

```tsx
import { EmptyState } from '@/components/empty-state'

export default function AccountsPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Accounts</h1>
      <EmptyState
        title="No linked accounts"
        hint="Bank linking via Plaid arrives in the next plan."
      />
    </section>
  )
}
```

- [ ] **Step 4: Settings page**

Create `finance-tracker/web/app/(app)/settings/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Signed in as</p>
        <p className="font-medium">{user?.email}</p>
      </Card>
    </section>
  )
}
```

- [ ] **Step 5: Verify it builds**

Run: `npm run build`
Expected: build succeeds; the route list shows `/`, `/transactions`, `/budgets`, `/goals`, `/bills`, `/accounts`, `/settings`, `/login`, `/auth/callback`.

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/app/\(app\) finance-tracker/web/components/empty-state.tsx
git commit -m "feat(web): add placeholder feature pages with empty states"
```

---

### Task 12: Full verification & docs

**Files:**
- Modify: `CLAUDE.md` (mark Plan 3 status)

- [ ] **Step 1: Run the full test suite**

Run:

```bash
cd finance-tracker/web
npx vitest run
```

Expected: PASS — all finance-logic tests green (24 tests).

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: build succeeds with no type errors and all nine routes listed.

- [ ] **Step 3: Manual smoke test (requires a Supabase project)**

With `.env.local` filled in from a real Supabase project and the Task 7 migration applied:

```bash
npm run dev
```

Then:
1. Visit `http://localhost:3000/transactions` → redirected to `/login` (middleware guard works).
2. Enter your email → "Check your email for a sign-in link."
3. Click the emailed link → redirected to `/` showing a `$0.00` net worth and the placeholder widget grid.
4. Visit `/settings` → shows your email.
5. Click "Sign out" → redirected to `/login`.

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", change the Plan 3 line to:

```markdown
- Plan 3 — Web app foundation (`2026-06-11-web-app-foundation.md`) — **in progress** (auth, schema, app shell, finance-logic library)
```

And under "### Brainstorming Progress", mark the remaining sections complete (pages/routes, components/file structure, error handling/auth flow, testing strategy) and note the design doc and Plan 3 are written.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark web app foundation plan in progress"
```

---

## Done criteria

- `npx vitest run` is green (net worth, budgets, goals, bills).
- `npm run build` succeeds with all nine routes.
- Unauthenticated access to any `(app)` route redirects to `/login`; magic-link sign-in lands on the dashboard; sign-out returns to `/login`.
- Schema + RLS migration exists and has been applied to a Supabase project.
- No Plaid wiring and no real feature CRUD yet — those are Plans 4 and 5.
