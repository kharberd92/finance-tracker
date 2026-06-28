# Daily Auto-Sync Implementation Plan

> **STATUS: COMPLETE — implemented & merged to `main` 2026-06-28.** All 7 code tasks done (TDD, 141/141 tests green, `tsc`/build clean) and passed a multi-agent adversarial review (7 findings: 5 fixed, 1 declined with reason, 1 covered by the migration step). **Two live-infra verifications remain with the user** (left unchecked below): apply migration `0006`, set `SUPABASE_SERVICE_ROLE_KEY`, then run the `sync:daily` smoke test (Task 5 Step 5) and register the scheduled task (Task 7 Step 3).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an autonomous once-a-day Plaid sync that runs via Windows Task Scheduler with no Next server and no user session, reusing the existing sync logic.

**Architecture:** Extract the per-item sync orchestration out of `app/api/sync/route.ts` into a shared `lib/plaid/sync-items.ts` that operates per `item.user_id` (so it works under a session OR a service-role client). A standalone `scripts/daily-sync.ts`, run by Task Scheduler via `tsx`, uses a new service-role Supabase client to sync all items. A `last_synced_at` column + a small UI label give visibility.

**Tech Stack:** Next.js 16 · TypeScript · Supabase (`@supabase/supabase-js` already a direct dep) · Plaid · Vitest · `tsx` (new dev dep) · Node 24 (`--env-file`) · Windows Task Scheduler / PowerShell.

## Global Constraints

- **Single-user app.** No multi-user logic; the script syncs every `plaid_items` row (all belong to the one user). The shared module still writes per `item.user_id` for correctness.
- **No Vercel Cron route now** (deferred until deployed); the shared module keeps it trivial later.
- **No new runtime dependencies** — `@supabase/supabase-js@^2.108.1` is already direct. The ONLY new dependency is the dev tool **`tsx`**.
- **Service-role secret** `SUPABASE_SERVICE_ROLE_KEY` lives only in gitignored `.env.local` (verified untracked) + a placeholder in `.env.local.example`. `lib/supabase/admin.ts` is server/script-only — never imported by client/browser code.
- **Migrations are sequential** — the next number is **`0006`** (existing run through `0005_normalize_transaction_categories.sql`). Each migration must be applied to the Supabase project (dashboard SQL editor or `supabase db push`).
- **The manual `/api/sync` route keeps its external contract:** 401 when unauthenticated; returns `{ added, modified, removed }` JSON on success; 502 on a hard failure. Its existing test must stay green.
- Sticky category preserved: on `modified` transactions, update Plaid-owned fields but NOT `category`.
- All commands run from `finance-tracker/web/`. Verification gate for every task: `npx tsc --noEmit` clean and `npx vitest run` green (plus the task's own new tests).

---

## File Structure

**Create:**
- `supabase/migrations/0006_plaid_last_synced.sql` — adds `last_synced_at` to `plaid_items` (Task 1).
- `lib/plaid/sync-items.ts` — shared per-item sync orchestration (Task 2).
- `lib/plaid/sync-items.test.ts` — its unit tests (Task 2).
- `lib/supabase/admin.ts` — service-role Supabase client factory (Task 4).
- `lib/supabase/admin.test.ts` — env-wiring test (Task 4).
- `scripts/daily-sync.ts` — Task Scheduler entry point (Task 5).
- `lib/finance/relative-time.ts` + `lib/finance/relative-time.test.ts` — "X ago" helper (Task 6).
- `scripts/setup-daily-sync.ps1` — Windows Task Scheduler registration (Task 7).

**Modify:**
- `lib/types.ts` — add `last_synced_at` to `PlaidItem` (Task 1).
- `app/api/sync/route.ts` — delegate to `syncPlaidItems` (Task 3).
- `app/api/sync/route.test.ts` — keep green after delegation (Task 3).
- `package.json` — add `tsx` devDep + `sync:daily` script (Task 5).
- `.env.local.example` — document `SUPABASE_SERVICE_ROLE_KEY` (Task 4).
- `app/(app)/accounts/page.tsx` — render "Last synced X ago" (Task 6).
- `.gitignore` / a `.gitignore` consideration for `logs/` (Task 7).

---

## Task 1: Migration + `last_synced_at` on the type

**Files:**
- Create: `supabase/migrations/0006_plaid_last_synced.sql`
- Modify: `lib/types.ts` (the `PlaidItem` interface, lines ~59-66)

**Interfaces:**
- Produces: `PlaidItem.last_synced_at?: string | null`; a `plaid_items.last_synced_at timestamptz` column.

- [x] **Step 1: Write the migration**

Create `supabase/migrations/0006_plaid_last_synced.sql`:

```sql
-- Track when each Plaid item was last successfully synced (for the daily
-- auto-sync job and the "Last synced" UI label). Nullable: null = never synced.
alter table plaid_items
  add column if not exists last_synced_at timestamptz;
```

- [x] **Step 2: Add the field to the `PlaidItem` type**

In `lib/types.ts`, change the `PlaidItem` interface from:

```ts
export interface PlaidItem {
  id: string
  user_id: string
  plaid_item_id: string
  encrypted_access_token: string
  sync_cursor?: string | null
  institution_name: string
}
```

to (add the last line):

```ts
export interface PlaidItem {
  id: string
  user_id: string
  plaid_item_id: string
  encrypted_access_token: string
  sync_cursor?: string | null
  institution_name: string
  last_synced_at?: string | null
}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add supabase/migrations/0006_plaid_last_synced.sql lib/types.ts
git commit -m "feat(web): add plaid_items.last_synced_at column and type"
```

> **Note for implementer:** apply this migration to the Supabase project (dashboard SQL editor or `supabase db push`) before the daily sync or the UI label can read/write the column. Note this in your report.

---

## Task 2: Shared sync module `lib/plaid/sync-items.ts`

Extracts the per-item loop currently inline in `app/api/sync/route.ts` into a reusable function that takes a Supabase client + a Plaid client + items, operates per `item.user_id`, isolates per-item errors, and stamps `last_synced_at`.

**Files:**
- Create: `lib/plaid/sync-items.ts`
- Test: `lib/plaid/sync-items.test.ts`

**Interfaces:**
- Consumes: `runSync` (`lib/plaid/sync.ts`), `mapAccount`/`mapTransaction`/`PlaidAccountLike`/`PlaidTxnLike` (`lib/plaid/map.ts`), `decryptToken` (`lib/plaid/crypto.ts`), `PlaidItem` (`lib/types.ts`, with `last_synced_at` from Task 1), `SupabaseClient` (`@supabase/supabase-js`), `PlaidApi` (`plaid`).
- Produces:
  ```ts
  type SyncTotals = { added: number; modified: number; removed: number }
  type SyncItemError = { itemId: string; message: string }
  type SyncResult = { totals: SyncTotals; errors: SyncItemError[]; itemsSynced: number }
  function syncPlaidItems(db: SupabaseClient, client: PlaidApi, items: PlaidItem[]): Promise<SyncResult>
  ```

- [x] **Step 1: Write the failing test**

Create `lib/plaid/sync-items.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncPlaidItems } from './sync-items'
import { createSupabaseMock, createQueryStub } from './test-helpers'
import { encryptToken } from './crypto'
import type { PlaidItem } from '@/lib/types'

function makeItem(over: Partial<PlaidItem> = {}): PlaidItem {
  return {
    id: 'item-1',
    user_id: 'user-1',
    plaid_item_id: 'plaid-item-1',
    encrypted_access_token: encryptToken('access-sandbox-1'),
    sync_cursor: null,
    institution_name: 'Chase',
    ...over,
  }
}

// A Plaid client stub: one account, one added transaction, no further pages.
function createPlaidStub() {
  return {
    accountsBalanceGet: vi.fn().mockResolvedValue({
      data: {
        accounts: [
          { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } },
        ],
      },
    }),
    transactionsSync: vi.fn().mockResolvedValue({
      data: {
        added: [
          { transaction_id: 'tx-1', account_id: 'pa-1', amount: 12.5, date: '2026-06-20', name: 'Coffee', personal_finance_category: { primary: 'FOOD_AND_DRINK' } },
        ],
        modified: [],
        removed: [],
        next_cursor: 'cursor-1',
        has_more: false,
      },
    }),
  }
}

beforeEach(() => {
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('syncPlaidItems', () => {
  it('syncs an item: refreshes accounts, writes txns with item.user_id, saves cursor + last_synced_at', async () => {
    const accountsStub = createQueryStub({ data: [{ id: 'acc-1', plaid_account_id: 'pa-1' }], error: null })
    const txStub = createQueryStub()
    const itemsStub = createQueryStub()
    const db = createSupabaseMock({ tables: { accounts: accountsStub, transactions: txStub, plaid_items: itemsStub } })
    const client = createPlaidStub()

    const result = await syncPlaidItems(db as never, client as never, [makeItem({ user_id: 'user-1' })])

    expect(result.itemsSynced).toBe(1)
    expect(result.totals).toEqual({ added: 1, modified: 0, removed: 0 })
    expect(result.errors).toEqual([])
    // transactions upsert used the item's user_id
    expect(txStub.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ user_id: 'user-1', plaid_transaction_id: 'tx-1' })]),
      expect.anything(),
    )
    // cursor + last_synced_at stamped
    expect(itemsStub.update).toHaveBeenCalledWith(
      expect.objectContaining({ sync_cursor: 'cursor-1', last_synced_at: expect.any(String) }),
    )
  })

  it('isolates per-item errors: one failing item does not abort the others', async () => {
    const okAccounts = createQueryStub({ data: [{ id: 'acc-1', plaid_account_id: 'pa-1' }], error: null })
    const db = createSupabaseMock({ tables: { accounts: okAccounts, transactions: createQueryStub(), plaid_items: createQueryStub() } })
    const client = createPlaidStub()
    // First item's balance call throws; second succeeds.
    client.accountsBalanceGet
      .mockRejectedValueOnce(new Error('plaid down'))
      .mockResolvedValueOnce({ data: { accounts: [{ account_id: 'pa-1', name: 'C', type: 'depository', subtype: 'checking', balances: { current: 1 } }] } })

    const result = await syncPlaidItems(db as never, client as never, [
      makeItem({ id: 'bad', user_id: 'user-1' }),
      makeItem({ id: 'good', user_id: 'user-1' }),
    ])

    expect(result.itemsSynced).toBe(1)
    expect(result.errors).toEqual([{ itemId: 'bad', message: 'plaid down' }])
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/plaid/sync-items.test.ts`
Expected: FAIL — `syncPlaidItems` is not defined / module not found.

- [x] **Step 3: Implement the module**

Create `lib/plaid/sync-items.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlaidApi } from 'plaid'
import { decryptToken } from '@/lib/plaid/crypto'
import { mapAccount, mapTransaction, type PlaidAccountLike, type PlaidTxnLike } from '@/lib/plaid/map'
import { runSync, type SyncPage } from '@/lib/plaid/sync'
import type { PlaidItem } from '@/lib/types'

export type SyncTotals = { added: number; modified: number; removed: number }
export type SyncItemError = { itemId: string; message: string }
export type SyncResult = { totals: SyncTotals; errors: SyncItemError[]; itemsSynced: number }

/**
 * Syncs the given Plaid items into Supabase. Works with either a session client
 * (RLS, manual route) or a service-role client (headless script): it writes per
 * `item.user_id`, never a single ambient user. Each item is isolated — one
 * failure is recorded in `errors` and does not abort the rest.
 */
export async function syncPlaidItems(
  db: SupabaseClient,
  client: PlaidApi,
  items: PlaidItem[],
): Promise<SyncResult> {
  const totals: SyncTotals = { added: 0, modified: 0, removed: 0 }
  const errors: SyncItemError[] = []
  let itemsSynced = 0

  for (const item of items) {
    try {
      const accessToken = decryptToken(item.encrypted_access_token)

      // Refresh balances and upsert accounts so the id map is complete.
      const balances = await client.accountsBalanceGet({ access_token: accessToken })
      const accountRows = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
        mapAccount(a, item.user_id, item.id, item.institution_name),
      )
      if (accountRows.length > 0) {
        await db.from('accounts').upsert(accountRows, { onConflict: 'user_id,plaid_account_id' })
      }

      // Build plaid_account_id -> our account id map.
      const { data: ourAccounts } = await db
        .from('accounts')
        .select('id, plaid_account_id')
        .eq('item_id', item.id)
      const idMap: Record<string, string> = {}
      for (const row of (ourAccounts ?? []) as { id: string; plaid_account_id: string }[]) {
        idMap[row.plaid_account_id] = row.id
      }

      const result = await runSync<PlaidTxnLike, PlaidTxnLike>(
        item.sync_cursor ?? null,
        async (cursor) => {
          const resp = await client.transactionsSync({
            access_token: accessToken,
            ...(cursor ? { cursor } : {}),
          })
          const d = resp.data
          return {
            added: d.added as PlaidTxnLike[],
            modified: d.modified as PlaidTxnLike[],
            removed: d.removed as { transaction_id: string }[],
            nextCursor: d.next_cursor,
            hasMore: d.has_more,
          } satisfies SyncPage<PlaidTxnLike, PlaidTxnLike>
        },
        async ({ added, modified, removedIds }) => {
          if (added.length > 0) {
            const rows = added.map((t) => mapTransaction(t, item.user_id, idMap))
            await db.from('transactions').upsert(rows, { onConflict: 'user_id,plaid_transaction_id' })
          }
          // Sticky category: update Plaid-owned fields but NOT category.
          for (const t of modified) {
            const row = mapTransaction(t, item.user_id, idMap)
            await db
              .from('transactions')
              .update({
                account_id: row.account_id,
                amount: row.amount,
                date: row.date,
                merchant_name: row.merchant_name,
              })
              .eq('user_id', item.user_id)
              .eq('plaid_transaction_id', row.plaid_transaction_id)
          }
          if (removedIds.length > 0) {
            await db
              .from('transactions')
              .delete()
              .eq('user_id', item.user_id)
              .in('plaid_transaction_id', removedIds)
          }
        },
      )

      await db
        .from('plaid_items')
        .update({ sync_cursor: result.cursor, last_synced_at: new Date().toISOString() })
        .eq('id', item.id)

      totals.added += result.added
      totals.modified += result.modified
      totals.removed += result.removed
      itemsSynced += 1
    } catch (e) {
      errors.push({ itemId: item.id, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { totals, errors, itemsSynced }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/plaid/sync-items.test.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add lib/plaid/sync-items.ts lib/plaid/sync-items.test.ts
git commit -m "feat(web): extract reusable per-item Plaid sync (sync-items)"
```

---

## Task 3: Delegate the manual route to the shared module

**Files:**
- Modify: `app/api/sync/route.ts`
- Modify: `app/api/sync/route.test.ts` (keep green)

**Interfaces:**
- Consumes: `syncPlaidItems` (Task 2).
- Produces: unchanged HTTP contract — 401 unauth, `{ added, modified, removed }` on success, 502 on hard failure.

- [x] **Step 1: Replace the route body with delegation**

Replace the entire contents of `app/api/sync/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { syncPlaidItems } from '@/lib/plaid/sync-items'
import type { PlaidItem } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = createPlaidClient()
    const { data: items } = await supabase.from('plaid_items').select('*')
    const { totals } = await syncPlaidItems(supabase, client, (items ?? []) as PlaidItem[])
    return NextResponse.json(totals)
  } catch {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 502 })
  }
}
```

- [x] **Step 2: Run the existing route test**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: the 401 test passes. The "syncs one item" test likely still passes (same DB/Plaid mocks, identical behavior). **If it fails only because the `plaid_items` update assertion now also includes `last_synced_at`,** update that assertion in `app/api/sync/route.test.ts` to use `expect.objectContaining({ sync_cursor: <expected> })` (so it ignores the added `last_synced_at` field). Do not weaken any other assertion.

- [x] **Step 3: Re-run to confirm green**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS (all cases).

- [x] **Step 4: Full typecheck + suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean + all green.

- [x] **Step 5: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "refactor(web): manual sync route delegates to syncPlaidItems"
```

---

## Task 4: Service-role Supabase client

**Files:**
- Create: `lib/supabase/admin.ts`
- Test: `lib/supabase/admin.test.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `createClient` from `@supabase/supabase-js`.
- Produces: `createAdminClient(): SupabaseClient` (service-role; used by the script and any future cron).

- [x] **Step 1: Write the failing test**

Create `lib/supabase/admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn(() => ({ from: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { createAdminClient } from './admin'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
})

describe('createAdminClient', () => {
  it('constructs a supabase client with the service-role key and no session persistence', () => {
    createAdminClient()
    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-role-key',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
    )
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/supabase/admin.test.ts`
Expected: FAIL — `./admin` not found.

- [x] **Step 3: Implement the admin client**

Create `lib/supabase/admin.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client for headless jobs (the daily-sync script, and a
 * future Vercel cron route). Bypasses Row Level Security — NEVER import this
 * from client/browser code. Reads SUPABASE_SERVICE_ROLE_KEY from the env.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/supabase/admin.test.ts`
Expected: PASS.

- [x] **Step 5: Document the new env var**

In `.env.local.example`, add this line after the existing Supabase keys:

```
# Service-role key (server/script only — used by the daily-sync job; bypasses RLS). Never expose to the client.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [x] **Step 6: Commit**

```bash
git add lib/supabase/admin.ts lib/supabase/admin.test.ts .env.local.example
git commit -m "feat(web): add service-role Supabase admin client"
```

> **Note for implementer:** add the real `SUPABASE_SERVICE_ROLE_KEY` (from Supabase dashboard → Project Settings → API) to your gitignored `.env.local`. Note this in your report.

---

## Task 5: The daily-sync script + `tsx` + npm script

**Files:**
- Create: `scripts/daily-sync.ts`
- Modify: `package.json` (add `tsx` devDep + `sync:daily` script)

**Interfaces:**
- Consumes: `createAdminClient` (Task 4), `createPlaidClient` (`lib/plaid/client.ts`), `syncPlaidItems` (Task 2), `PlaidItem` (`lib/types.ts`).
- Produces: an executable entry point + an `npm run sync:daily` command.

- [x] **Step 1: Install `tsx` as a dev dependency**

Run: `npm install -D tsx`
Expected: `tsx` appears under `devDependencies` in `package.json`.

- [x] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
"sync:daily": "node --env-file=.env.local --import tsx scripts/daily-sync.ts"
```

- [x] **Step 3: Write the script**

Create `scripts/daily-sync.ts`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { createPlaidClient } from '@/lib/plaid/client'
import { syncPlaidItems } from '@/lib/plaid/sync-items'
import type { PlaidItem } from '@/lib/types'

async function main() {
  const db = createAdminClient()
  const client = createPlaidClient()

  const { data: items, error } = await db.from('plaid_items').select('*')
  if (error) throw new Error(`Failed to load plaid_items: ${error.message}`)

  const result = await syncPlaidItems(db, client, (items ?? []) as PlaidItem[])

  console.log(
    `[daily-sync] items synced: ${result.itemsSynced}/${(items ?? []).length} · ` +
      `added ${result.totals.added}, modified ${result.totals.modified}, removed ${result.totals.removed}`,
  )
  for (const e of result.errors) {
    console.error(`[daily-sync] item ${e.itemId} failed: ${e.message}`)
  }
  // Non-zero exit if any item failed, so Task Scheduler surfaces the failure.
  if (result.errors.length > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('[daily-sync] fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
```

- [x] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors. If `scripts/daily-sync.ts` is not picked up by `tsconfig.json`'s `include`, add `"scripts/**/*.ts"` to the `include` array (the Next default usually globs `**/*.ts`, so this is often already covered — only add if tsc reports the file is not type-checked or `@/` fails to resolve).

- [ ] **Step 5: Manual smoke test (Plaid sandbox)** — _PENDING: requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` + the `0006` migration applied. Not yet run._

Prereq: `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` and Plaid sandbox creds, the `0006` migration is applied, and at least one item is linked (sandbox `user_good`/`pass_good`).
Run: `npm run sync:daily`
Expected: a `[daily-sync] items synced: …` line, exit code 0; in Supabase, the synced item's `last_synced_at` is now set to a recent timestamp. Record the output in your report.

- [x] **Step 6: Commit**

```bash
git add scripts/daily-sync.ts package.json package-lock.json
git commit -m "feat(web): add daily-sync script and sync:daily command"
```

---

## Task 6: "Last synced X ago" — pure helper + accounts label

**Files:**
- Create: `lib/finance/relative-time.ts`
- Test: `lib/finance/relative-time.test.ts`
- Modify: `app/(app)/accounts/page.tsx`

**Interfaces:**
- Produces: `formatRelativeTime(iso: string | null, now: Date): string`.

- [x] **Step 1: Write the failing test**

Create `lib/finance/relative-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from './relative-time'

const now = new Date('2026-06-28T12:00:00Z')

describe('formatRelativeTime', () => {
  it('returns "Never synced" for null', () => {
    expect(formatRelativeTime(null, now)).toBe('Never synced')
  })
  it('returns "just now" under a minute', () => {
    expect(formatRelativeTime('2026-06-28T11:59:30Z', now)).toBe('just now')
  })
  it('formats minutes', () => {
    expect(formatRelativeTime('2026-06-28T11:45:00Z', now)).toBe('15m ago')
  })
  it('formats hours', () => {
    expect(formatRelativeTime('2026-06-28T09:00:00Z', now)).toBe('3h ago')
  })
  it('formats days', () => {
    expect(formatRelativeTime('2026-06-26T12:00:00Z', now)).toBe('2d ago')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/finance/relative-time.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the helper**

Create `lib/finance/relative-time.ts`:

```ts
/** Compact relative time for sync timestamps. `iso` null = never synced. */
export function formatRelativeTime(iso: string | null, now: Date): string {
  if (!iso) return 'Never synced'
  const diffMs = now.getTime() - new Date(iso).getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/finance/relative-time.test.ts`
Expected: PASS (5 tests).

- [x] **Step 5: Render the label on the accounts page**

In `app/(app)/accounts/page.tsx`, add the import:

```ts
import { formatRelativeTime } from '@/lib/finance/relative-time'
```

After the existing `accounts` fetch (after line ~11, `const accounts = (data ?? []) as Account[]`), add a query for the most recent sync time:

```ts
  const { data: lastRow } = await supabase
    .from('plaid_items')
    .select('last_synced_at')
    .order('last_synced_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  const lastSynced = formatRelativeTime((lastRow?.last_synced_at as string | null) ?? null, new Date())
```

Then change the header block so the sync controls show the label. Replace:

```tsx
        <div className="flex gap-2">
          <ConnectBankButton />
          <SyncButton />
        </div>
```

with:

```tsx
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Last synced: {lastSynced}</span>
          <ConnectBankButton />
          <SyncButton />
        </div>
```

- [x] **Step 6: Typecheck + build + suite**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: clean, build succeeds, all tests green.

- [x] **Step 7: Commit**

```bash
git add lib/finance/relative-time.ts lib/finance/relative-time.test.ts "app/(app)/accounts/page.tsx"
git commit -m "feat(web): show last-synced time on the accounts page"
```

---

## Task 7: Windows Task Scheduler setup script

**Files:**
- Create: `scripts/setup-daily-sync.ps1`
- Modify: `.gitignore` (ignore the log file) — only if the repo's `.gitignore` would otherwise track it

**Interfaces:**
- Consumes: the `sync:daily` npm script (Task 5).
- Produces: a registered Windows Task Scheduler job named `FinanceTrackerDailySync`.

- [x] **Step 1: Write the setup script**

Create `scripts/setup-daily-sync.ps1`:

```powershell
<#
  Registers (or updates) a daily Windows Task Scheduler job that runs the
  finance-tracker Plaid sync. Run from an elevated PowerShell:

      pwsh -File scripts/setup-daily-sync.ps1 -Time 06:00

  The machine must be on/awake at the scheduled time. Re-run on a new machine
  after cloning + `npm install` + recreating `.env.local`.
#>
param(
  [string]$Time = '06:00',
  [string]$TaskName = 'FinanceTrackerDailySync'
)

$ErrorActionPreference = 'Stop'

# Resolve the web project dir (parent of this script's /scripts folder).
$webDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $webDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'daily-sync.log'

# Run npm via cmd so the scheduler can find it; append stdout+stderr to the log.
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw 'npm.cmd not found on PATH.' }

$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"$npm run sync:daily >> `"$logFile`" 2>&1`"" `
  -WorkingDirectory $webDir

$trigger = New-ScheduledTaskTrigger -Daily -At $Time

# Start when available (catch up a missed run) and allow waking the machine.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description 'Daily Plaid transaction sync for Finance Tracker' -Force

Write-Host "Registered task '$TaskName' to run 'npm run sync:daily' daily at $Time."
Write-Host "Logs: $logFile"
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
```

- [x] **Step 2: Ignore the log output**

Confirm the log file won't be committed. Run: `git check-ignore finance-tracker/web/logs/daily-sync.log && echo IGNORED || echo NOT-IGNORED`
- If it prints `NOT-IGNORED`, add a `finance-tracker/web/.gitignore` entry (or append to the existing one): a line `logs/`.
- If it prints `IGNORED`, do nothing.

- [ ] **Step 3: Manual verification** — _PENDING: requires an elevated PowerShell + working `.env.local`. Not yet run._

From an elevated PowerShell in `finance-tracker/web`:
Run: `pwsh -File scripts/setup-daily-sync.ps1 -Time 06:00`
Expected: "Registered task 'FinanceTrackerDailySync'…". Then:
Run: `Start-ScheduledTask -TaskName 'FinanceTrackerDailySync'` and after a few seconds check `logs/daily-sync.log` shows a `[daily-sync] items synced: …` line. Record this in your report.

- [x] **Step 4: Commit**

```bash
git add scripts/setup-daily-sync.ps1
# include the .gitignore only if you created/edited one in Step 2:
# git add finance-tracker/web/.gitignore
git commit -m "feat(web): add Windows Task Scheduler setup for daily sync"
```

---

## Self-Review

**Spec coverage:**
- Shared `lib/plaid/sync-items.ts` operating per `item.user_id` with per-item isolation + `last_synced_at` stamping → Task 2. ✓
- Manual route delegates, contract preserved, test green → Task 3. ✓
- Service-role `lib/supabase/admin.ts` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.local.example` → Task 4. ✓
- `scripts/daily-sync.ts` via `tsx` + `--env-file`, non-zero exit on errors → Task 5. ✓
- `last_synced_at` migration (`0006`) + type + "Last synced X ago" label → Tasks 1, 6. ✓
- `scripts/setup-daily-sync.ps1` (daily, start-when-available, wake-to-run, logging) → Task 7. ✓
- Non-goals respected: no multi-user logic, no Vercel cron route, no webhooks/retry, only new dep is `tsx`. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type/name consistency:** `syncPlaidItems(db, client, items) → { totals, errors, itemsSynced }` is defined in Task 2 and consumed with that exact shape in Tasks 3 and 5. `createAdminClient()` (Task 4) consumed in Task 5. `formatRelativeTime(iso, now)` (Task 6) used on the accounts page. `PlaidItem.last_synced_at` (Task 1) read/written in Tasks 2 and 6. Migration number `0006` is consistent with the existing `0005`. ✓

**Note on testing depth:** the script (`daily-sync.ts`) and the PowerShell setup are verified manually (I/O + OS integration), not unit-tested — the meaningful logic (`syncPlaidItems`, `formatRelativeTime`, admin wiring) is unit-tested. This is consistent with the project's "pure logic is the tested layer" pattern.
