# UI Visual Refresh — Premium Fintech Design

**Date:** 2026-06-27
**Status:** Approved design — ready for implementation planning
**Builds on:** the whole web app (`2026-06-11-finance-tracker-web-design.md` + the Plan 5 slices 5a–5e). This is a **visual-only** refresh layered over the finished feature set; no feature logic changes.

## Overview

The app is functionally complete (Plan 5 done) but visually stock — it ships the
default neutral-grayscale shadcn theme, no real font, flat cards, no dark mode, and
hardcoded `green-600`/`red-600` income/expense colors that don't adapt to a theme. This
refresh applies a restrained **premium / modern-fintech** look across **all pages**:
a classic-blue accent, the Inter typeface with tabular numerals for money, softly
elevated cards, and a real light/dark mode with a nav toggle. The dashboard gets a
focused layout pass (hero row, restyled chart, refined nav); every other page inherits
the new tokens for free.

Approved via a visual companion brainstorm on 2026-06-27 ("ok looks good" on
`full-dashboard-v3.html`). The approved mockup lives at
`.superpowers/brainstorm/2049-1782535516/content/full-dashboard-v3.html`.

### Goals
- A cohesive **blue-accented** theme replacing the stock neutral shadcn palette.
- **Light + dark** mode, wired via `next-themes`, with a nav toggle; default = system.
- **Inter** loaded through `next/font`, with **tabular numerals** on all money figures.
- **Soft-elevation cards** (subtle shadow + 1px border, `rounded-xl`).
- **Theme-aware semantic tokens** for income (green) / expense (red) / net (accent),
  replacing the 12 files that hardcode `green-*`/`red-*` so dark mode works everywhere.
- A **dashboard layout pass**: 2-col hero, net-worth delta chip, restyled cashflow chart
  (balanced height, wider rounded bars, gridlines, legend, segmented 6M/12M control),
  refined nav (active-link underline + theme toggle), per-widget accent "View all →".

### Non-goals (out of scope)
- **No feature/logic changes.** Pure `lib/finance/` math is untouched; data flow, Server
  Actions, queries, and routes are unchanged. This is presentation only.
- **No charting library** — the cashflow chart stays hand-rolled SVG (restyled, not
  rewritten).
- **No new pages or widgets**, no net-worth trend, no new data.
- **No component-library swap** — still shadcn-on-Base-UI; we restyle via tokens and
  Tailwind classes, not a new UI kit.

## Codebase grounding (verified 2026-06-27)

- **Theme:** `app/globals.css` uses Tailwind v4 `@import "tailwindcss"` + `@theme inline`
  mapping `--color-*` to oklch CSS vars defined in `:root` and `.dark`. The current
  values are the **stock neutral grayscale** shadcn theme — `--primary` is near-black,
  there is no accent color, all `--chart-*` are grays. `.dark` block already exists.
- **Dark mode not wired:** `next-themes@^0.4.6` is installed but only imported by
  `components/ui/sonner.tsx`. `app/layout.tsx` has **no `ThemeProvider`**; `<html lang="en">`
  has no `class`/`suppressHydrationWarning` (the `suppressHydrationWarning` is on `<body>`).
  `@custom-variant dark (&:is(.dark *))` is already declared, so a `.dark` class on `<html>`
  is all the toggling mechanism needs.
- **Font:** none loaded. `--font-sans` is referenced in `@theme` and `@apply font-sans`
  (in `globals.css` `@layer base html`) but is **undefined** → falls back to default sans.
- **Cards:** shadcn `Card` (`components/ui/card.tsx`) — currently flat `rounded-xl border`
  with no shadow per the mockup's note (verify exact classes when editing).
- **Nav:** `components/nav/top-nav.tsx` is a **server component** (renders a `signOut`
  `<form>` + `Link`s, no client hooks). Adding an active-link underline (needs
  `usePathname`) and a theme toggle (needs `useTheme`) requires small **client islands**,
  not converting the whole nav to client.
- **App shell:** `app/(app)/layout.tsx` wraps pages in `<TopNav />` + `<main className="mx-auto max-w-5xl p-4">`.
- **Hardcoded income/expense colors (12 files)** use `green-*`/`red-*` (and need theme tokens):
  `components/dashboard/{cashflow-chart,cashflow-summary,budget-widget,recent-transactions-widget}.tsx`,
  `components/bills/{bill-form,bills-view}.tsx`, `components/budgets/{budget-form,budgets-view}.tsx`,
  `components/goals/goal-form.tsx`, `components/transactions/{transactions-view,transaction-form}.tsx`,
  and `app/login/page.tsx`.

## Design tokens

All values flow through CSS variables in `globals.css` so every page updates at once.

### Accent (blue)
- Light: `--primary` ≈ `#2563eb`; dark: ≈ `#3b82f6`. Used for buttons, active states,
  links, the net line, the segmented control, goal progress bars.
- An **accent-soft** surface (light ≈ `#eff4ff`) for subtle accent backgrounds (active
  segment, chips). Add as a token (e.g. extend the existing `--accent`/`--accent-foreground`
  pair, which today is a near-neutral gray — repurpose to the blue-soft surface).
- Convert hexes to oklch to match the file's existing format.

### Semantic income / expense / net
New theme-aware tokens (light/dark pairs), exposed to Tailwind via `@theme inline` so
they're usable as utility classes (e.g. `text-income`, `bg-expense/10`):
- `--income` — green (light ≈ `#16a34a`, dark a touch lighter for contrast).
- `--expense` — red (light ≈ `#dc2626`, dark lighter).
- `--net` — the accent blue.
- Plus soft background variants for chips/pills (e.g. income chip bg `#ecfdf3`).

These replace the hardcoded `green-600`/`red-600` across the 12 files. Net is colored by
sign: green when ≥ 0, red when negative (existing summary rule), but via tokens.

### Type
- **Inter** via `next/font/google` in `app/layout.tsx`, exposing `--font-sans`
  (the variable `@theme` already references). Weights ~400/500/600/700/800.
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on all money/number
  figures so columns align and digits don't jitter. Apply via a small utility class
  (e.g. a `.tnum` / `tabular-nums` Tailwind class) on currency spans, or globally on
  number-heavy elements.

### Cards & radius
- Soft elevation: subtle two-layer shadow (e.g. `0 1px 2px rgba(15,23,42,.04), 0 6px 16px rgba(15,23,42,.05)`)
  + 1px border, `rounded-xl` (~14px). Applied to shadcn `Card` so all pages inherit it.
  Tune shadow for dark mode (lighter borders, minimal shadow).

## Light / dark mode

- Wrap the app in a `next-themes` `ThemeProvider` (`attribute="class"`,
  `defaultTheme="system"`, `enableSystem`). Provider must be a client component;
  add it (e.g. `components/theme-provider.tsx`) and use it in `app/layout.tsx`.
- Add `suppressHydrationWarning` to **`<html>`** (next-themes sets the class on `<html>`
  pre-hydration). Keep the existing body-level note where still relevant.
- **Theme toggle** in the nav: a small client island (`useTheme`) cycling/​switching
  light↔dark (system as the default starting point). Matches the mockup's pill toggle.
- The `.dark` token block already exists; this refresh updates its values (accent,
  semantic colors, card surfaces) alongside `:root`.

## Dashboard layout pass

Restyle only — same data, same components, same `lib/finance/cashflow.ts`.

1. **2-col hero** (`grid`, collapses to 1-col on mobile): **net-worth card** (left,
   narrower) | **this-month summary** (right, wider, Income / Expenses / Net inline).
2. **Net-worth delta chip:** a small "▲ this month +$net" pill under the net-worth
   figure, reusing the current month's cashflow `net`. Negative net → red "▼ −$…".
3. **Cashflow chart restyle** (`components/dashboard/cashflow-chart.tsx`):
   - **Balanced medium height** — `viewBox="0 0 760 185"` (locked as mockup **v5** on
     2026-06-27, a ~12% bump over the earlier v3 `760×165`). The iteration history: v3
     `165` read too wide/short, v4 `200` too tall, **v5 `185` is the locked middle**.
     Keep it undistorted (`width:100%;height:auto`); in the `max-w-5xl` container it
     renders ~230px tall. Baseline at y≈140, five faint gridlines (baseline darker),
     month labels at y≈166.
   - **Wider, rounded bars** (`rx≈3`), well-spaced grouped income/expense pairs.
   - **Faint gridlines** (baseline darker, upper lines very light), **small centered
     legend** (Income / Expense / Net), accent **net polyline** with dots.
   - **Segmented 6M / 12M control** replacing the two separate buttons — a pill group;
     active segment = white surface + accent text. Toggle state stays client-side (the
     component is already `"use client"`; still slices 12 fetched months in memory).
   - **Watch [[svg-title-hydration-gotcha]]** when editing `<title>` hover elements — one
     string child, not interleaved expressions, or Next 16 hydration mismatches.
4. **Widgets:** keep the 2×2 grid; each card header gets an accent **"View all →"** link
   (already links to its page — restyle to accent). Mini progress bars use semantic
   tokens (budget over = expense red; goals = accent).
5. **Refined nav:** active link gets an **accent underline** (small client island using
   `usePathname`), plus the theme toggle. Brand mark/spacing per mockup.

## Implementation approach

Token-first, so most pages need no per-file edits:
1. Update `globals.css` `:root` + `.dark` (accent, semantic tokens, accent-soft) and add
   semantic tokens to `@theme inline`. Restyle `Card` (shadow/radius).
2. Load Inter in `app/layout.tsx`; add `ThemeProvider` + `suppressHydrationWarning` on `<html>`.
3. Add the theme toggle + active-link islands to the nav.
4. Sweep the 12 hardcoded-color files → semantic tokens; add tabular-nums to money spans.
5. Dashboard layout pass (hero, delta chip, chart restyle, segmented control).

## Verification

This is visual, so verification is build-correctness + manual/visual review (no new unit
tests; pure `lib/finance` logic is unchanged and its suites must stay green).

- `npm run build` succeeds; `npx tsc --noEmit` clean; `npx vitest run` green (unchanged).
- **No hydration warnings** in the console (theme class on `<html>`; chart `<title>` fix held).
- **Manual visual smoke** across **every** page (dashboard, transactions, budgets, goals,
  bills, accounts, settings, login) in **both light and dark**: blue accent present,
  Inter rendering, money figures tabular-aligned, cards elevated, income green / expense
  red / net blue legible in both modes, no leftover hardcoded `green-*`/`red-*`.
- **Theme toggle** flips light↔dark and persists; default follows system.
- Dashboard matches the approved `full-dashboard-v5.html` proportions (hero, balanced
  chart at `760×185`, segmented 6M/12M, delta chip, "View all →" links, active-nav
  underline).

## Done criteria
- Blue accent + Inter + tabular numerals + soft-elevation cards applied app-wide via tokens.
- Working light/dark mode with a nav toggle (default system), no hydration warnings.
- All 12 files migrated off hardcoded income/expense colors to theme-aware tokens.
- Dashboard layout pass landed (hero, delta chip, restyled chart + segmented control,
  refined nav), matching the approved mockup.
- `npm run build` / `tsc --noEmit` / `vitest run` all green; no feature/logic changes.
