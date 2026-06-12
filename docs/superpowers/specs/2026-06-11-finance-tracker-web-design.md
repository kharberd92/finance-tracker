# Personal Finance Tracker — Web App Design Spec

**Date:** 2026-06-11
**Platform:** Web (Next.js App Router), deployed to Vercel
**Status:** Approved design — ready for implementation planning (Plan 3)
**Supersedes:** `2026-05-24-personal-finance-tracker-design.md` (iOS design — the
web app replaces the iOS client for cross-device access; the Plaid serverless
backend from Plan 1 is reused).

## Overview

A personal finance web app covering the full money-management suite: spending/
expense tracking, budgets, net worth, bills & subscriptions, and financial
goals. Bank data is imported automatically via Plaid. User data lives in
Supabase (Postgres + auth) with Row Level Security. The frontend and API are a
single Next.js App Router project deployed to Vercel. Auth is passwordless
(Supabase magic link).

## Goals

- Track spending and net worth automatically from linked bank accounts.
- Set and monitor monthly category budgets.
- Track recurring bills & subscriptions (what's due and when).
- Save toward financial goals with progress tracking.
- Cross-device access from any browser; single-user, private data via RLS.

## Non-Goals

- Native mobile clients (the iOS plan is superseded; web is responsive instead).
- Multi-user / shared accounts (single-user per account; RLS isolates by `user_id`).
- Manual-first workflow (bank sync is primary; manual entry supplements it for
  cash or corrections).
- Playwright end-to-end tests (deferred to a later plan — see Testing Strategy).

## Architecture

A single Next.js App Router project (`finance-tracker/web/`) with two prior
components reused:

1. **Next.js web app** — UI (React Server Components) + Tailwind CSS + shadcn/ui.
   Data access is **Server Components for reads** and **Server Actions for
   mutations**, both talking to Supabase with the user's session (RLS enforced
   server-side). Minimal client JavaScript.
2. **Plaid endpoints as Route Handlers** — the three Plaid proxy endpoints from
   Plan 1 are **copied** into `app/api/*` as Next.js Route Handlers (TypeScript
   ports of the existing CommonJS handlers). The original `finance-tracker/
   backend/` is left in place until the web app is verified working.

**Language:** TypeScript throughout the web app. (The existing `backend/` stays
JavaScript/CommonJS; only the new web app is TS.)

### Data-Flow Pattern

- **Reads:** Server Components call `supabase.from(...)` directly on the server.
  No internal JSON API layer for app data.
- **Mutations:** Server Actions (`'use server'`) validate input with **Zod** at
  the boundary, perform the Supabase write, and return a typed `{ data } |
  { error }` result. Forms post to actions; the affected page re-renders.
- **Plaid:** Plaid Link's client SDK requires HTTP endpoints, so Plaid calls go
  through Route Handlers (`app/api/*`). Every client→Plaid `fetch` uses an
  AbortController timeout so the UI can never hang on a stalled request.

### Plaid Data Flow

1. User clicks "Connect Bank" (on `/accounts` or the dashboard) → client calls
   `/api/create-link-token` → opens Plaid Link.
2. Plaid Link returns `publicToken` → client calls `/api/exchange-token` →
   server stores the encrypted `accessToken` in Supabase (`accounts` row).
3. On sync, server calls `/api/fetch-data` with the stored token → writes
   transactions/balances to Supabase.

The Plaid **secret key** lives only in the Vercel server environment. The Plaid
**access token** is stored encrypted in Supabase and used server-side.

## Database Schema (Supabase Postgres)

All tables have `user_id FK → auth.users` and Row Level Security (a user can
only read/write their own rows). Net worth is computed at query time, not
stored.

- **accounts** — `id`, `user_id`, `name`, `type` (checking | savings | credit |
  investment), `current_balance`, `institution_name`, `plaid_account_id?`,
  `encrypted_plaid_access_token?`
- **transactions** — `id`, `user_id`, `account_id?`, `amount` (negative =
  expense), `date`, `merchant_name`, `category`, `notes`, `is_manual`
- **budgets** — `id`, `user_id`, `category`, `monthly_limit`
- **bills** — `id`, `user_id`, `name`, `amount`, `due_day`, `frequency` (weekly
  | monthly | quarterly | yearly), `category`, `is_paid`
- **goals** — `id`, `user_id`, `name`, `target_amount`, `current_amount`,
  `target_date?`, `icon`, `color_hex`

SQL migrations (table definitions + RLS policies) live in `supabase/migrations/`.

## Pages & Routes

Persistent top navigation across all protected pages, with Bills and Accounts
as their own top-level items (the iOS "More" tab is unpacked into the nav).

### Public routes (no auth)

- **`/login`** — magic-link request form.
- **`/auth/callback`** — Route Handler; exchanges the magic-link code for a
  session, sets cookies, redirects to `/`.

### Protected routes (auth required, grouped under `(app)`)

- **`/`** — **Dashboard**, a widget-grid "command center": compact net-worth
  figure with month-over-month delta on top, then a grid of cards — spent vs.
  budget, goals progress, upcoming bills, recent transactions — plus a "Connect
  Bank" action. Pulls from every table.
- **`/transactions`** — full list with search and filter by account/category;
  tap to edit category/notes; "+" for manual entry.
- **`/budgets`** — category budgets with progress bars; create/edit; visual
  alert when near/over limit.
- **`/goals`** — goal cards with progress rings; create, contribute, view
  projected completion date.
- **`/bills`** — bills & subscriptions list with due dates; mark paid.
- **`/accounts`** — linked banks (add via Plaid Link, remove), balances,
  reconnect prompt for expired tokens.
- **`/settings`** — profile, sign out.

## Auth Flow (Supabase Magic Link)

1. Unauthenticated request to any `(app)` route → `middleware.ts` finds no valid
   session → redirect to `/login`.
2. `/login` form posts email to the `signInWithMagicLink` Server Action →
   Supabase emails a magic link.
3. User clicks link → `/auth/callback?code=...` → Route Handler exchanges the
   code for a session, sets cookies, redirects to `/`.
4. `middleware.ts` runs on every request to refresh the session token.
5. Sign out = `signOut` Server Action → clears session → redirect to `/login`.

**Two-layer guard (defense in depth):** middleware does the coarse redirect, and
`(app)/layout.tsx` (a Server Component) re-checks `getUser()` and redirects if
null — so no protected page renders without a verified user. Middleware alone is
not trusted for authorization.

## Error Handling

| Failure | Handling |
|---|---|
| Form/validation errors | Server Actions validate with Zod and return a typed `{ error }`; the form renders the message inline. |
| Supabase query/mutation error | Mutations return the error → toast (shadcn `<Toaster>`). Failed reads in Server Components throw → caught by a route-segment `error.tsx` with retry. |
| Plaid down / 502 | Plaid Route Handlers return 502 on any Plaid error. Client→Plaid `fetch` calls use an AbortController timeout so they cannot hang; on failure they show a retry banner. |
| Plaid `ITEM_LOGIN_REQUIRED` (expired token) | "Reconnect this bank" prompt on `/accounts` that re-runs Plaid Link in update mode. |
| Not found / bad route | App Router `not-found.tsx`. |
| Unexpected render crash | Root `error.tsx` boundary — never a white screen. |

**Empty states:** no linked accounts, no transactions, or no budgets render
friendly prompts (not blank tables), since a fresh user has no data until they
connect a bank or add manual entries.

## File Structure (`finance-tracker/web/`)

```
finance-tracker/web/
├─ app/
│  ├─ layout.tsx                  # Root layout: fonts, Tailwind globals, <Toaster>
│  ├─ globals.css
│  ├─ login/page.tsx              # Magic-link request form (public)
│  ├─ auth/
│  │  ├─ callback/route.ts        # Exchanges code → session, redirects to /
│  │  └─ actions.ts               # signInWithMagicLink, signOut
│  ├─ (app)/                      # Auth-guarded route group, shared app shell
│  │  ├─ layout.tsx               # TopNav + container; redirects to /login if no session
│  │  ├─ page.tsx                 # Dashboard (widget grid)
│  │  ├─ transactions/{page.tsx, actions.ts}
│  │  ├─ budgets/{page.tsx, actions.ts}
│  │  ├─ goals/{page.tsx, actions.ts}
│  │  ├─ bills/{page.tsx, actions.ts}      # actions incl. markPaid
│  │  ├─ accounts/{page.tsx, actions.ts}   # hosts <PlaidLinkButton>
│  │  └─ settings/page.tsx
│  └─ api/                        # Plaid Route Handlers (copied from backend/)
│     ├─ create-link-token/route.ts
│     ├─ exchange-token/route.ts
│     └─ fetch-data/route.ts
├─ components/
│  ├─ ui/                         # shadcn/ui primitives
│  ├─ nav/top-nav.tsx
│  ├─ dashboard/                  # net-worth-hero, spent-vs-budget, goals-widget,
│  │                             #   upcoming-bills, recent-transactions
│  ├─ transactions/               # transaction-table, transaction-form, filters
│  ├─ budgets/                    # budget-card, budget-form
│  ├─ goals/                      # goal-card (progress ring), goal-form
│  ├─ bills/                      # bill-row, bill-form
│  └─ plaid/plaid-link-button.tsx # client component wrapping react-plaid-link
├─ lib/
│  ├─ supabase/{server.ts, client.ts, middleware.ts}
│  ├─ plaid/client.ts             # Plaid factory (ported from backend/lib/plaidClient.js)
│  ├─ finance/                    # PURE logic: net-worth, budget rollups,
│  │                             #   goal projection, bill due-date math (unit-tested)
│  └─ types.ts                    # shared TS types
├─ middleware.ts                  # refreshes Supabase session on every request
├─ supabase/
│  ├─ migrations/                 # SQL: tables + RLS policies
│  └─ seed.sql
├─ __tests__/                     # Vitest unit tests for lib/finance
├─ .env.local.example             # Supabase + Plaid keys
├─ components.json                # shadcn/ui config
├─ tailwind.config.ts
├─ tsconfig.json
└─ package.json
```

**Design rationale:**

- **`(app)` route group** holds all protected pages behind one shared
  `layout.tsx` that does the session check and renders the top nav — the guard
  and chrome live in exactly one place.
- **Pure finance logic isolated in `lib/finance/`** (net worth, budget rollups,
  goal projections, bill due-dates) so it is unit-testable without Supabase or
  React — this is where the real test value is.
- **Plaid backend copied in** under `app/api/*` and `lib/plaid/`; logic is a TS
  port of the existing `backend/` code, which stays in place until the web app
  is verified.

## Testing Strategy

Test runner: **Vitest** for the web app (the existing `backend/` keeps Jest;
the two coexist as separate packages).

**In scope for the foundation plan (Plan 3):**

1. **Unit tests — `lib/finance/`** (highest value; pure, deterministic):
   net-worth calc (asset/liability sign handling), budget "spent this month"
   rollups, goal progress + projected completion, bill due-date math across all
   frequencies. Written test-first (TDD) when implementing that logic.
2. **Server Action tests** — with a mocked Supabase client: Zod rejects bad
   input, valid input issues the right query, errors return the typed `{ error }`
   shape.
3. **Plaid Route Handler tests** — port the existing Jest pattern (mock the
   Plaid client; assert 405/400/502 and the timeout/abort path).

**Deferred to a later plan:**

- **Playwright e2e** for the two critical flows (magic-link auth → dashboard;
  add manual transaction → appears in list and updates dashboard stats).
- **Manual Plaid sandbox check** — bank linking via Plaid Link verified manually
  against Plaid's sandbox; not automated (third-party SDK iframe).

## Tech Stack Summary

| Concern              | Choice                                          |
|----------------------|-------------------------------------------------|
| Framework            | Next.js App Router (TypeScript)                 |
| UI / styling         | React Server Components, Tailwind CSS, shadcn/ui|
| Data reads           | Server Components → Supabase (RLS)              |
| Data mutations       | Server Actions (`'use server'`) + Zod validation|
| Auth                 | Supabase magic link (passwordless)             |
| Database             | Supabase Postgres + Row Level Security          |
| Bank linking         | Plaid Link (`react-plaid-link`) + Route Handlers|
| Plaid secret storage | Vercel server env; access token encrypted in DB |
| Testing              | Vitest (unit/action/handler); Playwright later  |
| Hosting              | Vercel                                          |

## Open Questions / Future Considerations

- Playwright e2e and automated Plaid sandbox coverage (later plan).
- Push/email notifications for upcoming bills and budget overages (future).
- User-defined transaction categorization rules beyond Plaid's categories.
- Investment holdings detail beyond balance.
- Eventual removal of `finance-tracker/backend/` once the web app's Route
  Handlers are verified in production.
