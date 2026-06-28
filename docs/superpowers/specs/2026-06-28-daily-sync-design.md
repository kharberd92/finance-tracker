# Daily Auto-Sync — Design

**Date:** 2026-06-28
**Status:** Approved design — ready for implementation planning
**Builds on:** Plan 4 Plaid bank sync (`2026-06-13-plaid-bank-sync-design.md`) — reuses `lib/plaid/{sync,map,crypto,client}.ts`, the `plaid_items` table, and the manual `/api/sync` route.

## Overview

Today bank transactions sync **only manually** — the `/api/sync` route handler runs the
Plaid delta sync, but the only thing that calls it is the "Sync now" button
(`components/plaid/sync-button.tsx`). This feature adds an **autonomous once-a-day sync**:
a standalone script, scheduled by Windows Task Scheduler, that syncs all Plaid items
without any user session and without the Next server running.

This is a **single-user, local-only** app running on Windows. The sync must run even on
days the user never opens the app (as long as the machine is awake) — so the trigger
lives outside any browser session. Because a scheduled job has no Supabase auth session,
it reaches the data through a **service-role** client (bypasses RLS), writing rows under
each item's own `user_id`.

The core work — extracting the per-item sync into a shared module + a service-role client
— is deliberately the same work a future Vercel Cron route would need, so this local
script is a stepping-stone: deploying later means adding a thin cron route that calls the
same module, with no rework.

### Goals
- A daily, autonomous sync of all Plaid items, independent of the Next server and of any
  logged-in session.
- Reuse the existing Plaid sync logic (no duplicated orchestration).
- A clean service-role access path for headless jobs, with secrets kept out of git.
- Minimal visibility that the job ran (a "Last synced X ago" label + a `last_synced_at`
  column).
- One-command re-setup on a new machine (committed PowerShell registration script).

### Non-goals (YAGNI)
- **No multi-user logic** — single-user app; the script syncs every `plaid_items` row,
  which all belong to the one user.
- **No Vercel Cron route now** — the shared module keeps that trivial later, but it isn't
  built until the app is deployed.
- **No webhooks**, no retry/backoff beyond per-item error isolation, no in-app UI for
  configuring the schedule (set via the PowerShell script), no `node-cron`/long-running
  process.

## Architecture

Five pieces, four of them new:

1. **`lib/plaid/sync-items.ts`** (new) — the shared sync orchestration, extracted from the
   route handler. Pure of HTTP/session concerns; takes a Supabase client + items.
2. **`lib/supabase/admin.ts`** (new) — a service-role Supabase client factory for headless
   use (script now, cron later). Uses the already-installed `@supabase/supabase-js`.
3. **`scripts/daily-sync.ts`** (new) — the entry point the scheduler runs; wires the admin
   client + Plaid client into the shared module and logs results.
4. **`scripts/setup-daily-sync.ps1`** (new) — registers the Windows Task Scheduler job.
5. **`app/api/sync/route.ts`** (modified) — now delegates to the shared module instead of
   inlining the loop; external behavior unchanged.

## Shared sync module — `lib/plaid/sync-items.ts`

Extracts the per-item orchestration currently inline in `app/api/sync/route.ts`
(balance refresh → `accounts` upsert → build `plaid_account_id`→our-id map → `runSync`
delta loop with sticky category → `sync_cursor` update). Key changes vs. the inline
version:

- **Operates per `item.user_id`** instead of a single session-resolved `user.id`. Every
  `mapAccount` / `mapTransaction` / `.eq('user_id', …)` uses the item's own `user_id`.
  This is what lets the same code run under a session (manual route) or service role
  (script). For the single user, `item.user_id` equals the session user, so the manual
  route's behavior is unchanged.
- **Per-item error isolation:** each item's sync is wrapped in try/catch. A failing item
  is recorded and skipped; remaining items still sync.
- **Stamps `last_synced_at`** on each item after a successful sync (alongside the existing
  `sync_cursor` update).

**Interface:**
```ts
type SyncTotals = { added: number; modified: number; removed: number }
type SyncItemError = { itemId: string; message: string }
type SyncResult = { totals: SyncTotals; errors: SyncItemError[]; itemsSynced: number }

// `client` is a Plaid client; `db` is any Supabase client (session or service-role).
async function syncPlaidItems(
  db: SupabaseClient,
  client: PlaidClient,
  items: PlaidItem[],
): Promise<SyncResult>
```

The function does **not** fetch items or resolve the user — callers pass the items they
fetched (route: RLS-scoped to the session user; script: service-role, all rows). This
keeps the module agnostic to how access was obtained.

## Manual route — `app/api/sync/route.ts` (modified)

Becomes thin:
1. Resolve session user (unchanged — still returns 401 when unauthenticated).
2. `select * from plaid_items` (RLS → only the session user's items).
3. `createPlaidClient()`, then `syncPlaidItems(supabase, client, items)`.
4. Return the `totals` JSON on success; **502** on a hard failure (e.g. Plaid client
   construction throws). Per-item errors are included/logged but do not by themselves turn
   a partial success into a 502.

The existing test (`app/api/sync/route.test.ts`) — which covers the 401 case and the
"syncs one item" happy path via `createSupabaseMock`/`createQueryStub` — must stay green;
update it only as needed to match the delegated shape.

## Service-role client — `lib/supabase/admin.ts` (new)

```ts
import { createClient } from '@supabase/supabase-js'

/** Service-role Supabase client for headless jobs (scripts, future cron).
 *  Bypasses RLS — never import from client/browser code. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```

- Uses `@supabase/supabase-js` (already a direct dependency — no new package).
- New env var **`SUPABASE_SERVICE_ROLE_KEY`** added to `.env.local` (gitignored — verified)
  and documented in `.env.local.example` as a placeholder.
- Server/script-only by convention; because the shared module writes per `item.user_id`,
  service-role writes still land under the correct user.

## Daily script — `scripts/daily-sync.ts` (new)

Run via **`tsx`** (new devDependency — required because Node 24's native TS does not
resolve the `@/` tsconfig path aliases the lib modules use). Env loaded from `.env.local`
via Node 24's `--env-file`. npm script:

```json
"sync:daily": "tsx --env-file=.env.local scripts/daily-sync.ts"
```

Flow:
1. `createAdminClient()` and `createPlaidClient()`.
2. `select * from plaid_items` (service-role → all rows).
3. `const result = await syncPlaidItems(admin, client, items)`.
4. Log a one-line summary (items synced, added/modified/removed totals) and any per-item
   errors to stdout/stderr.
5. **Exit non-zero** if `result.errors` is non-empty, so failures surface in the Task
   Scheduler log; exit 0 otherwise.

Idempotent and safe to overlap with a manual sync (cursor delta + upserts).

## Visibility — `last_synced_at`

- **Migration `0006_plaid_last_synced.sql`** — `alter table plaid_items add column
  last_synced_at timestamptz;` (nullable; must be applied to the Supabase project like
  prior migrations).
- The shared module sets `last_synced_at = now()` per item on success.
- **UI:** a minimal **"Last synced X ago"** label rendered near the Sync button (the only
  UI change). Reads the most recent `last_synced_at` across the user's items; shows
  "Never synced" when null. Relative-time formatting is a small pure helper (unit-tested
  with the other `lib/finance`/`lib/plaid` pure logic).

## Scheduling — `scripts/setup-daily-sync.ps1` (new)

A committed PowerShell script that registers (or updates) a Windows Task Scheduler job:
- Runs `npm run sync:daily` in `finance-tracker/web`, redirecting output to a gitignored
  log file (e.g. `finance-tracker/web/logs/daily-sync.log`).
- Daily trigger at a configurable time (default ~06:00), with **"start when available"**
  (catch up a missed run) and **wake-to-run** enabled.
- Idempotent: re-running re-registers the same named task.
- Documented tradeoff: the machine must be on/awake at the trigger time (the accepted
  limitation of a local, non-deployed setup). Re-running this script is the one extra
  step when moving to a new machine (beyond clone + `npm install` + recreating
  `.env.local`).

## Testing

- **`lib/plaid/sync-items.test.ts`** (new) — unit-test `syncPlaidItems` with mocked
  Supabase + Plaid (reusing `lib/plaid/test-helpers` `createSupabaseMock`/`createQueryStub`):
  - syncs multiple items, using each `item.user_id` for writes;
  - per-item error isolation — one item throwing still syncs the others and is reported in
    `errors`;
  - totals aggregation across items;
  - `last_synced_at` is stamped on successful items.
- **`app/api/sync/route.test.ts`** — stays green (route delegates to the module).
- **Relative-time helper** — small unit test (e.g. "just now", "3h ago", "Never synced").
- **Manual verification:** run `npm run sync:daily` against the Plaid sandbox
  (`user_good`/`pass_good`) and confirm transactions update and `last_synced_at` advances;
  run `setup-daily-sync.ps1` and confirm the task appears in Task Scheduler and a forced
  run succeeds.
- `npm run build`, `npx tsc --noEmit`, and `npx vitest run` all green.

## Done criteria
- `npm run sync:daily` syncs all Plaid items via the service-role client with no Next
  server and no session, stamping `last_synced_at`.
- `syncPlaidItems` is the single shared orchestration; the manual route delegates to it and
  its test stays green.
- `setup-daily-sync.ps1` registers a daily Task Scheduler job that runs the sync and logs
  output; re-runnable on a new machine.
- Migration `0006_plaid_last_synced.sql` applied; the dashboard shows "Last synced X ago".
- New unit tests green; `build`/`tsc`/`vitest` all pass.
- `SUPABASE_SERVICE_ROLE_KEY` documented in `.env.local.example`; no secrets committed.
