# UI Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a restrained premium-fintech visual refresh (blue accent, Inter, light/dark mode, soft-elevation cards, theme-aware income/expense/net colors, restyled dashboard) across the whole finance-tracker web app without changing any feature logic.

**Architecture:** Token-first. Define accent + semantic colors as CSS variables in `globals.css` so every page updates at once; wire `next-themes` + Inter in the root layout; restyle the shared `Card` and nav; sweep the 12 files that hardcode `green-*`/`red-*` onto the new tokens; finish with a dashboard layout pass (hero row, delta chip, restyled fixed-viewBox cashflow chart with a segmented 6M/12M control).

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 (`@theme inline` + oklch vars) · shadcn-on-Base-UI · `next-themes@^0.4.6` · `next/font`. No new dependencies.

## Global Constraints

- **No feature/logic changes.** Pure `lib/finance/` math, Server Actions, queries, routes, and DB are untouched. Presentation only.
- **No new dependencies** and **no charting library** — the cashflow chart stays hand-rolled SVG.
- **Next 16 conventions** (see `finance-tracker/web/AGENTS.md`): `cookies()` is async; shadcn Button composes via `render` prop not `asChild`. Not directly exercised here but do not regress them.
- **SVG `<title>` rule** ([[svg-title-hydration-gotcha]]): a `<title>` must have exactly **one string child** (a single template literal), never interleaved `{}` expressions, or Next 16 hydration mismatches.
- **Verification is build + visual** (this is a visual refresh; there is no new pure logic to unit-test). Every task ends with: `npm run build` succeeds, `npx tsc --noEmit` is clean, `npx vitest run` stays green (unchanged suites), plus a manual visual check in the running dev server. Then commit.
- All commands run from `finance-tracker/web/`.
- Locked design values come from the spec `docs/superpowers/specs/2026-06-27-ui-visual-refresh-design.md` and mockup `full-dashboard-v5.html`.

---

## File Structure

**Modified:**
- `app/globals.css` — accent + semantic income/expense/net tokens, accent-soft, `@theme inline` mappings (Task 1).
- `app/layout.tsx` — Inter via `next/font`, `ThemeProvider`, `<html>` class + `suppressHydrationWarning` (Task 2).
- `components/nav/top-nav.tsx` — host the theme toggle + extracted nav links (Tasks 2, 3).
- `components/ui/card.tsx` — soft elevation (Task 3).
- `components/dashboard/cashflow-chart.tsx` — semantic colors + fixed-viewBox restyle + segmented control (Tasks 4, 5).
- `components/dashboard/cashflow-summary.tsx`, `budget-widget.tsx`, `recent-transactions-widget.tsx`, `goals-widget.tsx`, `bills-widget.tsx` — semantic colors, tabular-nums, "View all →" links (Tasks 4, 5).
- `components/budgets/budgets-view.tsx`, `components/budgets/budget-form.tsx`, `components/bills/bills-view.tsx`, `components/bills/bill-form.tsx`, `components/goals/goal-form.tsx`, `components/transactions/transactions-view.tsx`, `components/transactions/transaction-form.tsx`, `app/login/page.tsx` — semantic/destructive token sweep (Task 4).
- `app/(app)/page.tsx` — dashboard hero grid + net-worth delta chip (Task 5).

**Created:**
- `components/theme-provider.tsx` — client `next-themes` provider wrapper (Task 2).
- `components/nav/theme-toggle.tsx` — client light/dark toggle island (Task 2).
- `components/nav/nav-links.tsx` — client active-link island using `usePathname` (Task 3).

---

## Task 1: Theme tokens (accent blue + income/expense/net + accent-soft)

Establishes every color the rest of the refresh consumes. Changing `--primary` to blue immediately recolors all shadcn Buttons, so this task is visually verifiable on its own.

**Files:**
- Modify: `app/globals.css` (`:root`, `.dark`, `@theme inline`)

**Interfaces:**
- Produces: Tailwind color utilities `*-income`, `*-expense`, `*-net`, `*-accent-soft` (e.g. `text-income`, `bg-expense`, `fill-income`, `bg-accent-soft`) usable across text/bg/border/fill/ring; a blue `--primary`; CSS var `--font-sans` consumed by Task 2.

- [ ] **Step 1: Add the income/expense/net/accent-soft mappings to `@theme inline`**

In `app/globals.css`, inside the existing `@theme inline { ... }` block, add these lines (anywhere among the other `--color-*` lines, e.g. right after `--color-accent: var(--accent);`):

```css
  --color-income: var(--income);
  --color-expense: var(--expense);
  --color-net: var(--net);
  --color-accent-soft: var(--accent-soft);
  --color-accent-soft-foreground: var(--accent-soft-foreground);
```

- [ ] **Step 2: Set the blue accent + semantic vars in `:root`**

In the `:root { ... }` block, **replace** these two existing lines:

```css
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
```

with:

```css
  --primary: oklch(0.548 0.234 262.9);
  --primary-foreground: oklch(0.985 0 0);
```

Then **add** these new lines inside `:root` (e.g. just below `--primary-foreground`):

```css
  --income: oklch(0.627 0.17 149.2);
  --income-foreground: oklch(0.985 0 0);
  --expense: oklch(0.577 0.245 27.325);
  --expense-foreground: oklch(0.985 0 0);
  --net: oklch(0.548 0.234 262.9);
  --accent-soft: oklch(0.968 0.013 256.5);
  --accent-soft-foreground: oklch(0.548 0.234 262.9);
```

- [ ] **Step 3: Set the dark-mode accent + semantic vars in `.dark`**

In the `.dark { ... }` block, **replace** these two existing lines:

```css
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
```

with:

```css
  --primary: oklch(0.623 0.214 259.8);
  --primary-foreground: oklch(0.985 0 0);
```

Then **add** these new lines inside `.dark`:

```css
  --income: oklch(0.723 0.192 149.6);
  --income-foreground: oklch(0.205 0 0);
  --expense: oklch(0.637 0.237 25.3);
  --expense-foreground: oklch(0.205 0 0);
  --net: oklch(0.623 0.214 259.8);
  --accent-soft: oklch(0.279 0.05 260);
  --accent-soft-foreground: oklch(0.882 0.06 256);
```

- [ ] **Step 4: Build + typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed with no errors.

- [ ] **Step 5: Visual check**

Run `npm run dev`, open any page with a button (e.g. `/login` or the nav "Sign out"). Expected: buttons are now blue, not near-black. No layout change.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat(web): add blue accent + income/expense/net theme tokens"
```

---

## Task 2: Inter font + dark mode wiring + theme toggle

Loads Inter (the `--font-sans` var Task 1's `@theme` already references) and makes `.dark` actually toggle. `next-themes` is installed but currently only imported by `sonner.tsx`.

**Files:**
- Create: `components/theme-provider.tsx`
- Create: `components/nav/theme-toggle.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/nav/top-nav.tsx`

**Interfaces:**
- Consumes: `--font-sans` (Task 1 / existing `@theme`), the `.dark` token block (Task 1).
- Produces: `<ThemeProvider>` wrapper; a `<ThemeToggle />` island mounted in the nav; `.dark` class applied to `<html>` so all `.dark` tokens activate.

- [ ] **Step 1: Create the theme provider**

Create `components/theme-provider.tsx`:

```tsx
'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ComponentProps } from 'react'

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

- [ ] **Step 2: Load Inter and wrap the app in `app/layout.tsx`**

Replace the entire contents of `app/layout.tsx` with:

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Finance Tracker',
  description: 'Personal finance tracker',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html>
    // before hydration; this scopes the suppression to html's own attributes.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Create the theme toggle island**

Create `components/nav/theme-toggle.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Avoid hydration mismatch: render a stable placeholder until mounted.
  const isDark = mounted && resolvedTheme === 'dark'

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted ? (isDark ? '☀️' : '🌙') : '🌙'}
    </Button>
  )
}
```

- [ ] **Step 4: Mount the toggle in the nav**

In `components/nav/top-nav.tsx`, add the import at the top:

```tsx
import { ThemeToggle } from '@/components/nav/theme-toggle'
```

Then place `<ThemeToggle />` just before the `<form action={signOut}>` block:

```tsx
        <ThemeToggle />
        <form action={signOut}>
```

- [ ] **Step 5: Build + typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed.

- [ ] **Step 6: Visual check**

Run `npm run dev`, sign in. Expected: text now renders in Inter; clicking the toggle in the nav flips the whole app between light and dark; reload keeps the chosen theme; first load follows the OS setting. No hydration warnings in the browser console.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx components/theme-provider.tsx components/nav/theme-toggle.tsx components/nav/top-nav.tsx
git commit -m "feat(web): load Inter font and wire light/dark mode with a nav toggle"
```

---

## Task 3: Card soft elevation + active-nav underline

Two small shared-chrome touches that apply app-wide.

**Files:**
- Modify: `components/ui/card.tsx`
- Create: `components/nav/nav-links.tsx`
- Modify: `components/nav/top-nav.tsx`

**Interfaces:**
- Consumes: nav `LINKS` list (currently inline in `top-nav.tsx`).
- Produces: `<NavLinks />` client island rendering the links with an active-state accent underline; elevated `Card`.

- [ ] **Step 1: Give `Card` soft elevation**

In `components/ui/card.tsx`, in the `Card` function's `className`, replace the `ring-1 ring-foreground/10` fragment with a border + shadow. Change:

```tsx
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
```

to:

```tsx
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl border bg-card py-(--card-spacing) text-sm text-card-foreground shadow-sm [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
```

(The only change: `ring-1 ring-foreground/10` → `border ... shadow-sm`. `border` uses the theme `--border`; `shadow-sm` gives the subtle elevation. `rounded-xl` already resolves to ~14px via the existing `--radius`.)

- [ ] **Step 2: Create the active-link island**

Create `components/nav/nav-links.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/budgets', label: 'Budgets' },
  { href: '/goals', label: 'Goals' },
  { href: '/bills', label: 'Bills' },
  { href: '/accounts', label: 'Accounts' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <ul className="flex flex-1 gap-4 text-sm">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              className={
                active
                  ? 'relative font-semibold text-foreground after:absolute after:-bottom-[17px] after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }
            >
              {l.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 3: Use `NavLinks` in `top-nav.tsx`**

In `components/nav/top-nav.tsx`: remove the inline `const LINKS = [...]` array and the `<ul>...</ul>` block that maps it, and remove the now-unused `import Link from 'next/link'` **only if** `Link` is no longer referenced elsewhere in the file (the `/settings` link still uses it — so keep the `Link` import). Add the import:

```tsx
import { NavLinks } from '@/components/nav/nav-links'
```

Replace the `<ul className="flex flex-1 gap-3 text-sm"> ... </ul>` block with:

```tsx
        <NavLinks />
```

The resulting `top-nav.tsx` keeps `<span>💰 Finance Tracker</span>`, then `<NavLinks />`, then the `/settings` link, `<ThemeToggle />`, and the sign-out form.

- [ ] **Step 4: Build + typecheck**

Run: `npm run build && npx tsc --noEmit`
Expected: both succeed (no unused-import errors).

- [ ] **Step 5: Visual check**

Run `npm run dev`. Expected: cards across all pages now have a subtle shadow + border (not the old flat ring); the current page's nav link is bold with a blue underline; underline tracks navigation. Verify in both light and dark.

- [ ] **Step 6: Commit**

```bash
git add components/ui/card.tsx components/nav/nav-links.tsx components/nav/top-nav.tsx
git commit -m "feat(web): soft-elevation cards and active-link underline in nav"
```

---

## Task 4: Semantic color sweep (income/expense/net + destructive + tabular-nums)

Migrate every hardcoded `green-*`/`red-*` to theme-aware tokens so dark mode is correct everywhere. Two flavors: **income/expense** → new `income`/`expense` tokens; **validation errors** → existing `text-destructive` token. The `amber-*` "near budget / warning" colors are intentionally left as-is (a third warning accent, not part of the income/expense/net trio), except the green paid-pill in bills-view.

**Files (modify):**
- `components/dashboard/cashflow-summary.tsx`
- `components/dashboard/recent-transactions-widget.tsx`
- `components/dashboard/budget-widget.tsx`
- `components/budgets/budgets-view.tsx`
- `components/transactions/transactions-view.tsx`
- `components/bills/bills-view.tsx`
- `components/budgets/budget-form.tsx`
- `components/bills/bill-form.tsx`
- `components/goals/goal-form.tsx`
- `components/transactions/transaction-form.tsx`
- `app/login/page.tsx`

(The cashflow-chart fill colors are handled in Task 5 along with its restyle.)

**Interfaces:**
- Consumes: `text-income`/`text-expense`/`bg-income`/`bg-expense` (Task 1), existing `text-destructive`.
- Produces: no API change — visual only.

- [ ] **Step 1: cashflow-summary.tsx — income/expense/net + tabular-nums**

In `components/dashboard/cashflow-summary.tsx`:
- Line 14: `text-green-600` → `text-income`, and add `tabular-nums`:
  `<p className="font-semibold tabular-nums text-income">{usd(row.income)}</p>`
- Line 18: `text-red-600` → `text-expense`, add `tabular-nums`:
  `<p className="font-semibold tabular-nums text-expense">{usd(row.expense)}</p>`
- Line 22: replace `${row.net >= 0 ? 'text-green-600' : 'text-red-600'}` and add tabular:
  `<p className={`font-semibold tabular-nums ${row.net >= 0 ? 'text-income' : 'text-expense'}`}>`

- [ ] **Step 2: recent-transactions-widget.tsx**

In `components/dashboard/recent-transactions-widget.tsx` line 26, replace:

```tsx
                <span className={t.amount < 0 ? 'text-red-600' : 'text-green-600'}>{usd(t.amount)}</span>
```

with:

```tsx
                <span className={`tabular-nums ${t.amount < 0 ? 'text-expense' : 'text-income'}`}>{usd(t.amount)}</span>
```

- [ ] **Step 3: budget-widget.tsx**

In `components/dashboard/budget-widget.tsx` line 7, replace:

```tsx
const STATUS_BAR = { under: 'bg-green-600', near: 'bg-amber-500', over: 'bg-red-600' } as const
```

with:

```tsx
const STATUS_BAR = { under: 'bg-income', near: 'bg-amber-500', over: 'bg-expense' } as const
```

Also add `tabular-nums` to the spent figure (line ~40):

```tsx
                  <span className="tabular-nums text-muted-foreground">{usd(spent)} / {usd(b.monthly_limit)}</span>
```

- [ ] **Step 4: budgets-view.tsx**

In `components/budgets/budgets-view.tsx`:
- Lines 14–16 (the status map), replace:
  ```tsx
    under: 'bg-green-600',
    near: 'bg-amber-500',
    over: 'bg-red-600',
  ```
  with:
  ```tsx
    under: 'bg-income',
    near: 'bg-amber-500',
    over: 'bg-expense',
  ```
- Line 80, replace `text-red-600` with `text-expense`:
  ```tsx
                <p className={`text-xs ${status === 'over' ? 'text-expense' : 'text-muted-foreground'}`}>
  ```

- [ ] **Step 5: transactions-view.tsx**

In `components/transactions/transactions-view.tsx` line 129, replace:

```tsx
                    t.amount < 0 ? 'font-semibold text-red-600' : 'font-semibold text-green-600'
```

with:

```tsx
                    t.amount < 0 ? 'font-semibold tabular-nums text-expense' : 'font-semibold tabular-nums text-income'
```

- [ ] **Step 6: bills-view.tsx — paid pill**

In `components/bills/bills-view.tsx` line ~87, replace:

```tsx
                          paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
```

with theme-aware tokens (soft income background for paid; amber kept for unpaid warning):

```tsx
                          paid ? 'bg-income/15 text-income' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
```

- [ ] **Step 7: Error messages → `text-destructive` (5 files)**

`text-destructive` is an existing theme token (`#dc2626` light, lighter in dark). In each of these lines, replace `text-red-600` with `text-destructive`:
- `components/budgets/budget-form.tsx:91` → `<p className="text-sm text-destructive" role="alert">`
- `components/bills/bill-form.tsx:124` → `<p className="text-sm text-destructive" role="alert">`
- `components/goals/goal-form.tsx:124` → `<p className="text-sm text-destructive" role="alert">`
- `components/transactions/transaction-form.tsx:150` → `<p className="text-sm text-destructive" role="alert">`
- `app/login/page.tsx:38` → `<p className="text-sm text-destructive" role="alert">`

- [ ] **Step 8: Verify no income/expense red/green remain**

Run: `npx rg "(text|bg|fill)-(green|red)-(400|500|600|700)" components app`
Expected: **only** the cashflow-chart matches remain (handled in Task 5: `fill-green-600`, `fill-red-600`, `bg-green-600`, `bg-red-600`). No other hits. (`amber-*` hits are intentional and allowed.)

- [ ] **Step 9: Build + typecheck + tests**

Run: `npm run build && npx tsc --noEmit && npx vitest run`
Expected: all succeed; vitest unchanged and green.

- [ ] **Step 10: Visual check**

Run `npm run dev`, toggle dark mode. Expected: on `/transactions`, `/budgets`, `/bills`, the dashboard widgets, and `/login` errors — income reads green, expense/over reads red, validation errors read destructive-red, all legible in **both** light and dark. Money figures are tabular-aligned.

- [ ] **Step 11: Commit**

```bash
git add components app/login/page.tsx
git commit -m "feat(web): migrate hardcoded income/expense colors to theme tokens"
```

---

## Task 5: Dashboard layout pass

The focused dashboard restyle: 2-col hero, net-worth delta chip, and the fixed-viewBox cashflow chart with rounded bars, gridlines, and a segmented 6M/12M control. Matches mockup `full-dashboard-v5.html`.

**Files:**
- Modify: `app/(app)/page.tsx`
- Modify: `components/dashboard/cashflow-chart.tsx`
- Modify: `components/dashboard/budget-widget.tsx`, `goals-widget.tsx`, `bills-widget.tsx`, `recent-transactions-widget.tsx` (header "→" → "View all →" accent links)

**Interfaces:**
- Consumes: `monthlyCashflow` rows + `netWorth` (unchanged page data), `fill-income`/`fill-expense`/`text-primary` tokens (Tasks 1, 4), `cashflowDomain` (unchanged).
- Produces: no prop/signature changes — `CashflowChart` still takes `{ rows }`, widgets still take their existing props.

- [ ] **Step 1: Rewrite the cashflow chart with a fixed `760×185` viewBox + segmented control**

Replace the entire contents of `components/dashboard/cashflow-chart.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { cashflowDomain, type CashflowMonth } from '@/lib/finance/cashflow'

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Fixed viewBox — locks the chart's aspect ratio (~760×185, mockup v5) regardless
// of how many months are shown; bars are positioned by computed slot width.
const VB_W = 760
const VB_H = 185
const PAD = 20
const PLOT_TOP = 15
const PLOT_H = 125 // zero line lands at y=140 when the domain minimum is 0
const LABEL_Y = 166
const BAR_W = 22
const BAR_GAP = 6

function monthLabel(ym: string): string {
  return MONTH_ABBR[Number(ym.slice(5)) - 1] ?? ym
}

export function CashflowChart({ rows }: { rows: CashflowMonth[] }) {
  const [span, setSpan] = useState<6 | 12>(6)
  const data = rows.slice(-span)

  const domainMax = cashflowDomain(data)
  const domainMin = Math.min(0, ...data.map((r) => r.net))
  const range = domainMax - domainMin || 1
  const y = (v: number) => PLOT_TOP + ((domainMax - v) / range) * PLOT_H
  const y0 = y(0)

  const slotW = (VB_W - PAD * 2) / data.length
  const cx = (i: number) => PAD + slotW * i + slotW / 2
  const netPoints = data.map((r, i) => `${cx(i)},${y(r.net)}`).join(' ')
  const gridFractions = [0.25, 0.5, 0.75, 1]

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Cashflow</h2>
        <div className="flex rounded-lg bg-muted p-0.5 text-xs">
          {([6, 12] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpan(s)}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                span === s ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {s}M
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Monthly income, expense, and net cashflow"
      >
        {gridFractions.map((f) => {
          const gy = y0 - f * (y0 - PLOT_TOP)
          return <line key={f} x1={PAD} y1={gy} x2={VB_W - PAD} y2={gy} className="stroke-border/40" strokeWidth={1} />
        })}
        <line x1={PAD} y1={y0} x2={VB_W - PAD} y2={y0} className="stroke-border" strokeWidth={1} />

        {data.map((r, i) => {
          const incomeX = cx(i) - BAR_W - BAR_GAP / 2
          const expenseX = cx(i) + BAR_GAP / 2
          return (
            <g key={r.month}>
              <rect x={incomeX} y={y(r.income)} width={BAR_W} height={Math.max(0, y0 - y(r.income))} rx={3} className="fill-income" />
              <rect x={expenseX} y={y(r.expense)} width={BAR_W} height={Math.max(0, y0 - y(r.expense))} rx={3} className="fill-expense" />
              <title>{`${monthLabel(r.month)}: income ${usd(r.income)}, expense ${usd(r.expense)}, net ${usd(r.net)}`}</title>
              <text x={cx(i)} y={LABEL_Y} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {monthLabel(r.month)}
              </text>
            </g>
          )
        })}

        <g className="text-primary">
          <polyline points={netPoints} fill="none" stroke="currentColor" strokeWidth={2.5} />
          {data.map((r, i) => (
            <circle key={r.month} cx={cx(i)} cy={y(r.net)} r={3.5} fill="currentColor" />
          ))}
        </g>
      </svg>

      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-income" /> Income
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-expense" /> Expense
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-px w-3 bg-primary" /> Net
        </span>
      </div>
    </Card>
  )
}
```

(Note: the `<title>` is a single template literal — preserves the [[svg-title-hydration-gotcha]] fix. The `Button` import is dropped since the segmented control is plain buttons.)

- [ ] **Step 2: Dashboard hero grid + net-worth delta chip in `page.tsx`**

In `app/(app)/page.tsx`, replace the `return ( ... )` JSX (lines 46–66) with:

```tsx
  const lastNet = rows[rows.length - 1]?.net ?? 0
  const netLabel = lastNet >= 0 ? `▲ this month +${usd(lastNet)}` : `▼ this month ${usd(lastNet)}`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.3fr_2fr]">
        <Card className="p-6">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Net worth</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">
            {total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
          </p>
          <span
            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
              lastNet >= 0 ? 'bg-income/15 text-income' : 'bg-expense/15 text-expense'
            }`}
          >
            {netLabel}
          </span>
        </Card>

        <CashflowSummary row={rows[rows.length - 1]} />
      </div>

      <CashflowChart rows={rows} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BudgetWidget budgets={budgets} transactions={transactions} year={year} month={mon} />
        <GoalsWidget goals={goals} />
        <BillsWidget bills={bills} now={now} />
        <RecentTransactionsWidget transactions={transactions} />
      </div>
    </div>
  )
```

Then add the `usd` helper near the top of the file (after the imports, alongside `currentMonth`):

```tsx
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
```

- [ ] **Step 3: "View all →" accent links in the four widgets**

In each of `budget-widget.tsx`, `goals-widget.tsx`, `bills-widget.tsx`, `recent-transactions-widget.tsx`, replace the header link (currently `→` in muted) with an accent "View all →". For example in `budget-widget.tsx`:

```tsx
          <Link href="/budgets" className="text-xs font-medium text-primary hover:underline">View all →</Link>
```

Apply the same change per file with the matching href: `/goals`, `/bills`, `/transactions`. (Keep the `Link` import and surrounding `<div className="flex items-center justify-between">` header.)

- [ ] **Step 4: Build + typecheck + tests**

Run: `npm run build && npx tsc --noEmit && npx vitest run`
Expected: all succeed; vitest green.

- [ ] **Step 5: Visual check against mockup v5**

Run `npm run dev`, open the dashboard. Expected, matching `full-dashboard-v5.html`:
- Top row is 2 columns: net-worth card (with a green "▲ this month +$…" chip; negative → red ▼) | this-month Income/Expenses/Net summary.
- Cashflow chart: balanced height (not stretched-short), rounded green income / red expense bars, faint gridlines + darker baseline, blue net line with dots, centered legend, and a **segmented 6M/12M control** whose active segment has a white/card background + blue text. Toggling 6M↔12M is instant.
- Each widget header has a blue "View all →" link.
- Everything legible in light **and** dark; no hydration warnings in console.

- [ ] **Step 6: Commit**

```bash
git add app/(app)/page.tsx components/dashboard
git commit -m "feat(web): dashboard layout pass — hero, delta chip, restyled cashflow chart"
```

---

## Self-Review

**Spec coverage:**
- Blue accent → Task 1. ✓
- Light/dark + nav toggle (default system) → Task 2. ✓
- Inter + tabular numerals → Task 2 (font) + Tasks 4–5 (`tabular-nums` on money). ✓
- Soft-elevation cards → Task 3. ✓
- Semantic income/expense/net tokens replacing the hardcoded colors (12 files) → Task 1 (define) + Task 4 (sweep 11 files) + Task 5 (cashflow-chart, the 12th). ✓
- Dashboard layout pass (hero, delta chip, chart restyle at `760×185`, segmented control, "View all →", active-nav underline) → Task 5 + Task 3 (underline). ✓
- Non-goals respected: no logic changes, no charting library, no new pages/deps. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every step has concrete code or an exact command. ✓

**Type/name consistency:** `CashflowChart({ rows })` signature unchanged (page passes `rows`); `CashflowSummary({ row })` unchanged; widget props unchanged. New tokens used as `*-income`/`*-expense`/`*-net`/`*-accent-soft` consistently with the `@theme inline` names from Task 1. `text-destructive` is a pre-existing token. `ThemeProvider`/`ThemeToggle`/`NavLinks` names match between create and use. ✓

**Note on the 12-file count:** the spec lists 12 files with hardcoded income/expense colors. The error-message reds (5 form/login files) are correctly routed to the existing `text-destructive` token rather than the expense token, since they are validation errors, not expense figures. `amber-*` warning colors are intentionally retained (not part of the income/expense/net trio).
