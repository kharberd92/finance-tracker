# Plaid Bank Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the three Plaid endpoints into the Next.js app as secure, persistent Route Handlers, store the encrypted access token + sync cursor in a new `plaid_items` table, and add a minimal `/accounts` UI so bank data flows end-to-end into Supabase via a manual sync.

**Architecture:** Thin Route Handlers in `app/api/*` resolve the user from the Supabase session (never the request body) and delegate all logic to pure, unit-tested functions in `lib/plaid/` (`crypto`, `map`, `sync`). The Plaid access token is AES-256-GCM encrypted before storage and decrypted only inside the sync handler — it never reaches the browser. Sync does full `added`/`modified`/`removed` delta handling, looping `transactionsSync` until `has_more` is false, idempotent via a unique `(user_id, plaid_transaction_id)` key.

**Tech Stack:** Next.js 16 (App Router, Route Handlers) · TypeScript · `plaid` (server SDK) · `react-plaid-link` (client) · `@supabase/ssr` · Zod · `node:crypto` · Vitest

**Design source:** `docs/superpowers/specs/2026-06-13-plaid-bank-sync-design.md`

**Scope note:** Full vertical slice. Styled account/transaction rendering, filters, and dashboard widgets are **Plan 5**. Plaid webhooks / auto-sync are out of scope.

**Next 16 notes (verify against `node_modules/next/dist/docs/` if anything surprises you — see `finance-tracker/web/AGENTS.md`):** Route Handlers export named HTTP-method functions (`export async function POST(...)`). These handlers set `export const runtime = 'nodejs'` because the `plaid` SDK and `node:crypto` need Node APIs. All commands run from `finance-tracker/web/` unless noted.

**Manual steps the engineer cannot do (call them out, do not block on them):** Applying `0002_plaid.sql` to the Supabase project (SQL Editor) and filling `PLAID_CLIENT_ID`/`PLAID_SECRET`/`PLAID_TOKEN_ENC_KEY` in `.env.local` are done by the human during the Task 11 manual verification. All automated tests mock Plaid + Supabase and need no real credentials.

---

### Task 1: Add dependencies and the encryption-key env var

**Files:**
- Modify: `finance-tracker/web/package.json` (via npm install)
- Modify: `finance-tracker/web/.env.local.example`

- [ ] **Step 1: Install the Plaid SDK and React Link wrapper**

Run from `finance-tracker/web`:

```bash
npm install plaid react-plaid-link
```

Expected: both added to `dependencies` in `package.json`.

- [ ] **Step 2: Add `PLAID_TOKEN_ENC_KEY` to the env example**

Edit `finance-tracker/web/.env.local.example`. Replace the Plaid block at the bottom with:

```bash
# Plaid — sandbox credentials from the Plaid dashboard (Team Settings → Keys)
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
# 32-byte key for encrypting Plaid access tokens at rest. Generate with:
#   openssl rand -base64 32
PLAID_TOKEN_ENC_KEY=
```

- [ ] **Step 3: Verify the install**

Run: `npm ls plaid react-plaid-link`
Expected: both packages listed with resolved versions, no "missing" errors.

- [ ] **Step 4: Commit**

```bash
git add finance-tracker/web/package.json finance-tracker/web/package-lock.json finance-tracker/web/.env.local.example
git commit -m "feat(web): add plaid + react-plaid-link deps and token-encryption env var"
```

---

### Task 2: Schema migration and domain types

**Files:**
- Create: `finance-tracker/web/supabase/migrations/0002_plaid.sql`
- Modify: `finance-tracker/web/lib/types.ts`

- [ ] **Step 1: Write the migration**

Create `finance-tracker/web/supabase/migrations/0002_plaid.sql`:

```sql
-- Plaid bank sync: store one row per Plaid Item (bank login) holding the
-- encrypted access token + sync cursor; link accounts to it; give transactions
-- a Plaid id for idempotent delta sync.

create table if not exists plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_item_id text not null,
  encrypted_access_token text not null,   -- AES-256-GCM ciphertext, never plaintext
  sync_cursor text,                        -- transactionsSync bookmark; null until first sync
  institution_name text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, plaid_item_id)
);

create index if not exists idx_plaid_items_user on plaid_items (user_id);

-- accounts: link to the owning Item, drop the per-account token (empty today),
-- add an upsert key so re-sync updates balances instead of duplicating rows.
alter table accounts add column if not exists item_id uuid references plaid_items (id) on delete cascade;
alter table accounts drop column if exists encrypted_plaid_access_token;
alter table accounts add constraint accounts_user_plaid_acct_unique unique (user_id, plaid_account_id);

-- transactions: Plaid id is the delta-matching + idempotency key. Nullable so
-- manual transactions (is_manual = true) need no Plaid id.
alter table transactions add column if not exists plaid_transaction_id text;
alter table transactions add constraint transactions_user_plaid_txn_unique unique (user_id, plaid_transaction_id);

-- Row Level Security for the new table (same owner pattern as 0001).
alter table plaid_items enable row level security;
create policy plaid_items_owner on plaid_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
```

- [ ] **Step 2: Update the domain types**

Edit `finance-tracker/web/lib/types.ts`. In the `Account` interface, **remove** the line:

```ts
  encrypted_plaid_access_token?: string | null
```

and **add** in its place:

```ts
  item_id?: string | null
```

In the `Transaction` interface, add after `is_manual`:

```ts
  plaid_transaction_id?: string | null
```

At the end of the file, add a new interface:

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

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add finance-tracker/web/supabase/migrations/0002_plaid.sql finance-tracker/web/lib/types.ts
git commit -m "feat(web): add plaid_items schema migration and domain types"
```

---

### Task 3: Plaid client (TypeScript port)

**Files:**
- Create: `finance-tracker/web/lib/plaid/client.ts`

- [ ] **Step 1: Write the client factory**

Create `finance-tracker/web/lib/plaid/client.ts`:

```ts
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

/** Server-side Plaid client. Reads PLAID_CLIENT_ID / PLAID_SECRET / PLAID_ENV from the env. */
export function createPlaidClient(): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV ?? 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  })
  return new PlaidApi(config)
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/lib/plaid/client.ts
git commit -m "feat(web): add Plaid client factory (TS port)"
```

---

### Task 4: Token encryption (TDD)

**Files:**
- Create: `finance-tracker/web/lib/plaid/crypto.ts`
- Test: `finance-tracker/web/lib/plaid/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/plaid/crypto.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { encryptToken, decryptToken } from './crypto'

beforeAll(() => {
  // 32-byte key, base64-encoded, for the test run.
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('encryptToken / decryptToken', () => {
  it('round-trips a token back to the original plaintext', () => {
    const token = 'access-sandbox-abc123'
    expect(decryptToken(encryptToken(token))).toBe(token)
  })

  it('produces ciphertext that differs from the plaintext', () => {
    const token = 'access-sandbox-abc123'
    const encrypted = encryptToken(token)
    expect(encrypted).not.toContain(token)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'))
  })

  it('throws when the ciphertext has been tampered with', () => {
    const encrypted = encryptToken('access-sandbox-abc123')
    const [iv, tag, data] = encrypted.split(':')
    // Flip the last char of the ciphertext segment.
    const flipped = data.slice(0, -1) + (data.slice(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptToken(`${iv}:${tag}:${flipped}`)).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/plaid/crypto.test.ts`
Expected: FAIL — cannot find module `./crypto`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/plaid/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const b64 = process.env.PLAID_TOKEN_ENC_KEY
  if (!b64) throw new Error('PLAID_TOKEN_ENC_KEY is not set')
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error('PLAID_TOKEN_ENC_KEY must be a base64-encoded 32-byte key')
  }
  return key
}

/** Encrypts a token to a `iv:authTag:ciphertext` string (all base64). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':')
}

/** Reverses `encryptToken`. Throws if the payload is malformed or tampered with. */
export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext')
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/plaid/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/plaid/crypto.ts finance-tracker/web/lib/plaid/crypto.test.ts
git commit -m "feat(web): add AES-256-GCM token encryption"
```

---

### Task 5: Plaid → domain mappers (TDD)

**Files:**
- Create: `finance-tracker/web/lib/plaid/map.ts`
- Test: `finance-tracker/web/lib/plaid/map.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/plaid/map.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  mapAccountType,
  titleCaseCategory,
  mapTransaction,
  mapAccount,
  type PlaidTxnLike,
  type PlaidAccountLike,
} from './map'

describe('mapAccountType', () => {
  it('maps depository subtypes', () => {
    expect(mapAccountType('depository', 'checking')).toBe('checking')
    expect(mapAccountType('depository', 'savings')).toBe('savings')
    expect(mapAccountType('depository', null)).toBe('checking')
  })

  it('maps credit and loan to credit', () => {
    expect(mapAccountType('credit', 'credit card')).toBe('credit')
    expect(mapAccountType('loan', 'student')).toBe('credit')
  })

  it('maps investment and brokerage to investment', () => {
    expect(mapAccountType('investment', '401k')).toBe('investment')
    expect(mapAccountType('brokerage', null)).toBe('investment')
  })

  it('defaults unknown types to checking', () => {
    expect(mapAccountType('other', null)).toBe('checking')
  })
})

describe('titleCaseCategory', () => {
  it('title-cases a Plaid primary category', () => {
    expect(titleCaseCategory('FOOD_AND_DRINK')).toBe('Food And Drink')
  })

  it('falls back to Uncategorized when absent', () => {
    expect(titleCaseCategory(null)).toBe('Uncategorized')
    expect(titleCaseCategory(undefined)).toBe('Uncategorized')
  })
})

describe('mapTransaction', () => {
  const accountIdByPlaidId = { 'plaid-acct-1': 'our-acct-1' }

  function txn(partial: Partial<PlaidTxnLike>): PlaidTxnLike {
    return {
      transaction_id: 'ptxn-1',
      account_id: 'plaid-acct-1',
      amount: 40,
      date: '2026-06-02',
      name: 'RAW NAME',
      merchant_name: 'Trader Joe’s',
      personal_finance_category: { primary: 'FOOD_AND_DRINK' },
      ...partial,
    }
  }

  it('flips the sign so a Plaid outflow becomes a negative expense', () => {
    expect(mapTransaction(txn({ amount: 40 }), 'user-1', accountIdByPlaidId).amount).toBe(-40)
  })

  it('keeps income positive (Plaid inflow is negative)', () => {
    expect(mapTransaction(txn({ amount: -1500 }), 'user-1', accountIdByPlaidId).amount).toBe(1500)
  })

  it('resolves the account_id via the plaid id map, null when unknown', () => {
    expect(mapTransaction(txn({ account_id: 'plaid-acct-1' }), 'user-1', accountIdByPlaidId).account_id).toBe('our-acct-1')
    expect(mapTransaction(txn({ account_id: 'missing' }), 'user-1', accountIdByPlaidId).account_id).toBeNull()
  })

  it('uses merchant_name, falling back to name', () => {
    expect(mapTransaction(txn({ merchant_name: 'Costco' }), 'user-1', accountIdByPlaidId).merchant_name).toBe('Costco')
    expect(mapTransaction(txn({ merchant_name: null }), 'user-1', accountIdByPlaidId).merchant_name).toBe('RAW NAME')
  })

  it('maps category and marks the row non-manual with the Plaid id', () => {
    const row = mapTransaction(txn({}), 'user-1', accountIdByPlaidId)
    expect(row.category).toBe('Food And Drink')
    expect(row.is_manual).toBe(false)
    expect(row.plaid_transaction_id).toBe('ptxn-1')
    expect(row.user_id).toBe('user-1')
    expect(row.date).toBe('2026-06-02')
  })
})

describe('mapAccount', () => {
  function acct(partial: Partial<PlaidAccountLike>): PlaidAccountLike {
    return {
      account_id: 'plaid-acct-1',
      name: 'Checking',
      type: 'depository',
      subtype: 'checking',
      balances: { current: 1234.56 },
      ...partial,
    }
  }

  it('maps a Plaid account to our row shape', () => {
    const row = mapAccount(acct({}), 'user-1', 'item-1', 'Chase')
    expect(row).toEqual({
      user_id: 'user-1',
      item_id: 'item-1',
      plaid_account_id: 'plaid-acct-1',
      name: 'Checking',
      type: 'checking',
      current_balance: 1234.56,
      institution_name: 'Chase',
    })
  })

  it('defaults a null balance to 0', () => {
    expect(mapAccount(acct({ balances: { current: null } }), 'user-1', 'item-1', 'Chase').current_balance).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/plaid/map.test.ts`
Expected: FAIL — cannot find module `./map`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/plaid/map.ts`:

```ts
import type { AccountType } from '@/lib/types'

/** Minimal shape of the Plaid transaction fields we consume. */
export interface PlaidTxnLike {
  transaction_id: string
  account_id: string
  amount: number
  date: string
  name: string
  merchant_name?: string | null
  personal_finance_category?: { primary?: string | null } | null
}

/** Minimal shape of the Plaid account fields we consume. */
export interface PlaidAccountLike {
  account_id: string
  name: string
  type: string
  subtype: string | null
  balances: { current: number | null }
}

/** Row shape for an upsert into our `transactions` table. */
export interface MappedTransaction {
  user_id: string
  account_id: string | null
  amount: number
  date: string
  merchant_name: string
  category: string
  plaid_transaction_id: string
  is_manual: boolean
}

/** Row shape for an upsert into our `accounts` table. */
export interface MappedAccount {
  user_id: string
  item_id: string
  plaid_account_id: string
  name: string
  type: AccountType
  current_balance: number
  institution_name: string
}

/** Maps a Plaid account type/subtype to our enum. */
export function mapAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'credit' || type === 'loan') return 'credit'
  if (type === 'investment' || type === 'brokerage') return 'investment'
  if (type === 'depository') return subtype === 'savings' ? 'savings' : 'checking'
  return 'checking'
}

/** Title-cases a Plaid primary category (FOOD_AND_DRINK → Food And Drink). */
export function titleCaseCategory(primary: string | null | undefined): string {
  if (!primary) return 'Uncategorized'
  return primary
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Maps a Plaid transaction to our row. Plaid amounts are positive for outflow;
 * we store negative = expense, so the sign is flipped.
 */
export function mapTransaction(
  txn: PlaidTxnLike,
  userId: string,
  accountIdByPlaidId: Record<string, string>,
): MappedTransaction {
  return {
    user_id: userId,
    account_id: accountIdByPlaidId[txn.account_id] ?? null,
    amount: -txn.amount,
    date: txn.date,
    merchant_name: txn.merchant_name ?? txn.name,
    category: titleCaseCategory(txn.personal_finance_category?.primary),
    plaid_transaction_id: txn.transaction_id,
    is_manual: false,
  }
}

/** Maps a Plaid account to our row. */
export function mapAccount(
  account: PlaidAccountLike,
  userId: string,
  itemId: string,
  institutionName: string,
): MappedAccount {
  return {
    user_id: userId,
    item_id: itemId,
    plaid_account_id: account.account_id,
    name: account.name,
    type: mapAccountType(account.type, account.subtype),
    current_balance: account.balances.current ?? 0,
    institution_name: institutionName,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/plaid/map.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/plaid/map.ts finance-tracker/web/lib/plaid/map.test.ts
git commit -m "feat(web): add Plaid-to-domain mappers"
```

---

### Task 6: Sync delta loop (TDD)

**Files:**
- Create: `finance-tracker/web/lib/plaid/sync.ts`
- Test: `finance-tracker/web/lib/plaid/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/lib/plaid/sync.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { runSync, type SyncPage } from './sync'

describe('runSync', () => {
  it('loops until has_more is false, accumulating deltas and advancing the cursor', async () => {
    const pages: SyncPage<{ id: string }, { id: string }>[] = [
      {
        added: [{ id: 'a1' }, { id: 'a2' }],
        modified: [{ id: 'm1' }],
        removed: [{ transaction_id: 'r1' }],
        nextCursor: 'cursor-1',
        hasMore: true,
      },
      {
        added: [{ id: 'a3' }],
        modified: [],
        removed: [],
        nextCursor: 'cursor-2',
        hasMore: false,
      },
    ]
    const fetchPage = vi.fn(async (_cursor: string | null) => pages.shift()!)
    const apply = vi.fn(async () => {})

    const result = await runSync(null, fetchPage, apply)

    expect(result).toEqual({ added: 3, modified: 1, removed: 1, cursor: 'cursor-2' })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenNthCalledWith(1, null)
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1')
    // First apply gets the first page's deltas with removed mapped to ids.
    expect(apply).toHaveBeenNthCalledWith(1, {
      added: [{ id: 'a1' }, { id: 'a2' }],
      modified: [{ id: 'm1' }],
      removedIds: ['r1'],
    })
  })

  it('handles a single empty page (no-op sync)', async () => {
    const fetchPage = vi.fn(async () => ({
      added: [],
      modified: [],
      removed: [],
      nextCursor: 'same-cursor',
      hasMore: false,
    }))
    const apply = vi.fn(async () => {})

    const result = await runSync('same-cursor', fetchPage, apply)

    expect(result).toEqual({ added: 0, modified: 0, removed: 0, cursor: 'same-cursor' })
    expect(apply).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/plaid/sync.test.ts`
Expected: FAIL — cannot find module `./sync`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/lib/plaid/sync.ts`:

```ts
/** One page returned by a transactionsSync call, generic over the added/modified item type. */
export interface SyncPage<TAdded, TModified> {
  added: TAdded[]
  modified: TModified[]
  removed: { transaction_id: string }[]
  nextCursor: string
  hasMore: boolean
}

export interface SyncResult {
  added: number
  modified: number
  removed: number
  cursor: string
}

/**
 * Drives a Plaid transactionsSync pagination loop without touching Plaid or
 * Supabase directly. `fetchPage` gets the current cursor and returns one page;
 * `apply` persists that page's deltas. Loops until `hasMore` is false, then
 * returns the totals and the final cursor.
 */
export async function runSync<TAdded, TModified>(
  initialCursor: string | null,
  fetchPage: (cursor: string | null) => Promise<SyncPage<TAdded, TModified>>,
  apply: (delta: { added: TAdded[]; modified: TModified[]; removedIds: string[] }) => Promise<void>,
): Promise<SyncResult> {
  let cursor = initialCursor
  let added = 0
  let modified = 0
  let removed = 0

  for (;;) {
    const page = await fetchPage(cursor)
    await apply({
      added: page.added,
      modified: page.modified,
      removedIds: page.removed.map((r) => r.transaction_id),
    })
    added += page.added.length
    modified += page.modified.length
    removed += page.removed.length
    cursor = page.nextCursor
    if (!page.hasMore) break
  }

  return { added, modified, removed, cursor: cursor ?? '' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/plaid/sync.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/lib/plaid/sync.ts finance-tracker/web/lib/plaid/sync.test.ts
git commit -m "feat(web): add transactionsSync delta loop"
```

---

### Task 7: Test helpers for handler tests

**Files:**
- Create: `finance-tracker/web/lib/plaid/test-helpers.ts`

These mocks are shared by Tasks 8–10. A query stub is chainable and awaitable so both `await sb.from('t').upsert(rows)` and `await sb.from('t').select('*').single()` resolve.

- [ ] **Step 1: Write the helpers**

Create `finance-tracker/web/lib/plaid/test-helpers.ts`:

```ts
import { vi } from 'vitest'

export interface QueryResult {
  data: unknown
  error: unknown
}

/** A chainable + awaitable Supabase query-builder stub. */
export function createQueryStub(result: QueryResult = { data: null, error: null }) {
  const stub = {} as Record<string, ReturnType<typeof vi.fn>> & {
    then: (resolve: (r: QueryResult) => unknown) => unknown
  }
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'order', 'limit']) {
    stub[method] = vi.fn(() => stub)
  }
  stub.single = vi.fn().mockResolvedValue(result)
  stub.maybeSingle = vi.fn().mockResolvedValue(result)
  // Make the builder awaitable for chains that don't end in .single().
  stub.then = (resolve) => resolve(result)
  return stub
}

/**
 * A fake Supabase client. `user` defaults to a signed-in user (pass `null` for
 * unauthenticated). `tables` maps a table name to a specific query stub; any
 * other table returns a fresh empty stub.
 */
export function createSupabaseMock(opts: {
  user?: { id: string } | null
  tables?: Record<string, ReturnType<typeof createQueryStub>>
} = {}) {
  const user = opts.user === undefined ? { id: 'user-1' } : opts.user
  const tables = opts.tables ?? {}
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => tables[table] ?? createQueryStub()),
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add finance-tracker/web/lib/plaid/test-helpers.ts
git commit -m "test(web): add Supabase/query mocks for Plaid handler tests"
```

---

### Task 8: `POST /api/create-link-token` (TDD)

**Files:**
- Create: `finance-tracker/web/app/api/create-link-token/route.ts`
- Test: `finance-tracker/web/app/api/create-link-token/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/api/create-link-token/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/create-link-token', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('returns a link token on success', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const linkTokenCreate = vi.fn().mockResolvedValue({ data: { link_token: 'link-sandbox-1' } })
    mockedCreatePlaid.mockReturnValue({ linkTokenCreate } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ linkToken: 'link-sandbox-1' })
    expect(linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'user-1' } }),
    )
  })

  it('returns 502 when Plaid fails', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    mockedCreatePlaid.mockReturnValue({
      linkTokenCreate: vi.fn().mockRejectedValue(new Error('plaid down')),
    } as never)

    const res = await POST()
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/create-link-token/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/api/create-link-token/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { Products, CountryCode } from 'plaid'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'

export const runtime = 'nodejs'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const client = createPlaidClient()
    const response = await client.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Personal Finance Tracker',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    return NextResponse.json({ linkToken: response.data.link_token })
  } catch {
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/create-link-token/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/api/create-link-token
git commit -m "feat(web): add create-link-token route handler"
```

---

### Task 9: `POST /api/exchange-token` (TDD)

The handler exchanges the public token, encrypts the access token, inserts a `plaid_items` row, fetches balances, and upserts the accounts. `institutionName` comes from the client (Plaid Link metadata) — cosmetic only, identity is still session-derived.

**Files:**
- Create: `finance-tracker/web/app/api/exchange-token/route.ts`
- Test: `finance-tracker/web/app/api/exchange-token/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/api/exchange-token/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

function req(body: unknown): Request {
  return new Request('http://localhost/api/exchange-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('POST /api/exchange-token', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST(req({ publicToken: 'public-sandbox-1' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when publicToken is missing', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    const res = await POST(req({ institutionName: 'Chase' }))
    expect(res.status).toBe(400)
  })

  it('stores an encrypted item and upserts accounts on success', async () => {
    const itemsStub = createQueryStub({ data: { id: 'item-row-1' }, error: null })
    const accountsStub = createQueryStub()
    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({ tables: { plaid_items: itemsStub, accounts: accountsStub } }) as never,
    )
    mockedCreatePlaid.mockReturnValue({
      itemPublicTokenExchange: vi
        .fn()
        .mockResolvedValue({ data: { access_token: 'access-sandbox-1', item_id: 'plaid-item-1' } }),
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100 } },
          ],
        },
      }),
    } as never)

    const res = await POST(req({ publicToken: 'public-sandbox-1', institutionName: 'Chase' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, accountCount: 1 })

    // An item row was inserted, and the stored token is NOT the plaintext.
    expect(itemsStub.insert).toHaveBeenCalledOnce()
    const inserted = itemsStub.insert.mock.calls[0][0] as { encrypted_access_token: string }
    expect(inserted.encrypted_access_token).not.toContain('access-sandbox-1')
    expect(accountsStub.upsert).toHaveBeenCalledOnce()
  })

  it('returns 502 when Plaid fails', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock() as never)
    mockedCreatePlaid.mockReturnValue({
      itemPublicTokenExchange: vi.fn().mockRejectedValue(new Error('plaid down')),
    } as never)
    const res = await POST(req({ publicToken: 'public-sandbox-1' }))
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/exchange-token/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/api/exchange-token/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { encryptToken } from '@/lib/plaid/crypto'
import { mapAccount, type PlaidAccountLike } from '@/lib/plaid/map'

export const runtime = 'nodejs'

const bodySchema = z.object({
  publicToken: z.string().min(1),
  institutionName: z.string().optional().default(''),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'publicToken is required' }, { status: 400 })
  }
  const { publicToken, institutionName } = parsed.data

  try {
    const client = createPlaidClient()
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token

    const { data: item, error: itemError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user.id,
        plaid_item_id: exchange.data.item_id,
        encrypted_access_token: encryptToken(accessToken),
        institution_name: institutionName,
      })
      .select('id')
      .single()
    if (itemError || !item) {
      return NextResponse.json({ error: 'Failed to store item' }, { status: 500 })
    }

    const balances = await client.accountsBalanceGet({ access_token: accessToken })
    const accounts = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
      mapAccount(a, user.id, item.id, institutionName),
    )
    if (accounts.length > 0) {
      const { error: upsertError } = await supabase
        .from('accounts')
        .upsert(accounts, { onConflict: 'user_id,plaid_account_id' })
      if (upsertError) {
        return NextResponse.json({ error: 'Failed to store accounts' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, accountCount: accounts.length })
  } catch {
    return NextResponse.json({ error: 'Failed to exchange public token' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/exchange-token/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/app/api/exchange-token
git commit -m "feat(web): add exchange-token route handler (encrypt + persist)"
```

---

### Task 10: `POST /api/sync` (TDD)

For each of the user's `plaid_items`: refresh balances (upsert accounts), build a `plaid_account_id → our id` map, run the delta loop writing transactions, then save the new cursor. Uses `runSync` from Task 6.

**Files:**
- Create: `finance-tracker/web/app/api/sync/route.ts`
- Test: `finance-tracker/web/app/api/sync/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `finance-tracker/web/app/api/sync/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/plaid/client', () => ({ createPlaidClient: vi.fn() }))

import { POST } from './route'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { createSupabaseMock, createQueryStub } from '@/lib/plaid/test-helpers'
import { encryptToken } from '@/lib/plaid/crypto'

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePlaid = vi.mocked(createPlaidClient)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PLAID_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('POST /api/sync', () => {
  it('returns 401 when unauthenticated', async () => {
    mockedCreateClient.mockResolvedValue(createSupabaseMock({ user: null }) as never)
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('syncs one item: writes transactions, refreshes accounts, saves cursor', async () => {
    const itemsStub = createQueryStub({
      data: [
        {
          id: 'item-1',
          user_id: 'user-1',
          plaid_item_id: 'plaid-item-1',
          encrypted_access_token: encryptToken('access-sandbox-1'),
          sync_cursor: null,
          institution_name: 'Chase',
        },
      ],
      error: null,
    })
    // accounts: after upsert, a select returns our account rows for the id map.
    const accountsStub = createQueryStub({
      data: [{ id: 'our-acct-1', plaid_account_id: 'pa-1' }],
      error: null,
    })
    const txStub = createQueryStub()

    mockedCreateClient.mockResolvedValue(
      createSupabaseMock({
        tables: { plaid_items: itemsStub, accounts: accountsStub, transactions: txStub },
      }) as never,
    )

    mockedCreatePlaid.mockReturnValue({
      accountsBalanceGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [
            { account_id: 'pa-1', name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 500 } },
          ],
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [
            {
              transaction_id: 'ptxn-1',
              account_id: 'pa-1',
              amount: 40,
              date: '2026-06-02',
              name: 'Groceries',
              merchant_name: 'Trader Joe’s',
              personal_finance_category: { primary: 'FOOD_AND_DRINK' },
            },
          ],
          modified: [],
          removed: [],
          next_cursor: 'cursor-final',
          has_more: false,
        },
      }),
    } as never)

    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ added: 1, modified: 0, removed: 0 })

    // Transactions upserted, accounts refreshed, cursor saved on the item.
    expect(txStub.upsert).toHaveBeenCalled()
    expect(accountsStub.upsert).toHaveBeenCalled()
    expect(itemsStub.update).toHaveBeenCalledWith(
      expect.objectContaining({ sync_cursor: 'cursor-final' }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write the implementation**

Create `finance-tracker/web/app/api/sync/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createPlaidClient } from '@/lib/plaid/client'
import { decryptToken } from '@/lib/plaid/crypto'
import { mapAccount, mapTransaction, type PlaidAccountLike, type PlaidTxnLike } from '@/lib/plaid/map'
import { runSync, type SyncPage } from '@/lib/plaid/sync'
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
    const totals = { added: 0, modified: 0, removed: 0 }

    for (const item of (items ?? []) as PlaidItem[]) {
      const accessToken = decryptToken(item.encrypted_access_token)

      // Refresh balances and upsert accounts so the id map is complete.
      const balances = await client.accountsBalanceGet({ access_token: accessToken })
      const accountRows = (balances.data.accounts as PlaidAccountLike[]).map((a) =>
        mapAccount(a, user.id, item.id, item.institution_name),
      )
      if (accountRows.length > 0) {
        await supabase.from('accounts').upsert(accountRows, { onConflict: 'user_id,plaid_account_id' })
      }

      // Build plaid_account_id -> our account id map.
      const { data: ourAccounts } = await supabase
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
          const upserts = [...added, ...modified].map((t) => mapTransaction(t, user.id, idMap))
          if (upserts.length > 0) {
            await supabase
              .from('transactions')
              .upsert(upserts, { onConflict: 'user_id,plaid_transaction_id' })
          }
          if (removedIds.length > 0) {
            await supabase
              .from('transactions')
              .delete()
              .eq('user_id', user.id)
              .in('plaid_transaction_id', removedIds)
          }
        },
      )

      await supabase.from('plaid_items').update({ sync_cursor: result.cursor }).eq('id', item.id)

      totals.added += result.added
      totals.modified += result.modified
      totals.removed += result.removed
    }

    return NextResponse.json(totals)
  } catch {
    return NextResponse.json({ error: 'Failed to sync' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole test suite**

Run: `npx vitest run`
Expected: PASS — all suites green (Plan 3 finance tests + crypto, map, sync, and the three handler suites).

- [ ] **Step 6: Commit**

```bash
git add finance-tracker/web/app/api/sync
git commit -m "feat(web): add sync route handler (full delta sync to Supabase)"
```

---

### Task 11: Client UI — Connect Bank, Sync, accounts page

**Files:**
- Create: `finance-tracker/web/components/plaid/connect-bank-button.tsx`
- Create: `finance-tracker/web/components/plaid/sync-button.tsx`
- Modify: `finance-tracker/web/app/(app)/accounts/page.tsx`

- [ ] **Step 1: Connect Bank button**

Create `finance-tracker/web/components/plaid/connect-bank-button.tsx`:

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from 'react-plaid-link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function ConnectBankButton() {
  const router = useRouter()
  const [linkToken, setLinkToken] = useState<string | null>(null)

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        const res = await fetch('/api/exchange-token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            publicToken,
            institutionName: metadata.institution?.name ?? '',
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) throw new Error()
        toast.success('Bank connected. Click "Sync now" to import transactions.')
        router.refresh()
      } catch {
        toast.error('Could not finish connecting the bank.')
      } finally {
        setLinkToken(null)
      }
    },
    [router],
  )

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess })

  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  async function handleClick() {
    try {
      const res = await fetch('/api/create-link-token', {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error()
      const { linkToken } = (await res.json()) as { linkToken: string }
      setLinkToken(linkToken)
    } catch {
      toast.error('Could not start bank connection.')
    }
  }

  return <Button onClick={handleClick}>Connect Bank</Button>
}
```

- [ ] **Step 2: Sync button**

Create `finance-tracker/web/components/plaid/sync-button.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function SyncButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function handleSync() {
    setPending(true)
    try {
      const res = await fetch('/api/sync', { method: 'POST', signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error()
      const { added, modified, removed } = (await res.json()) as {
        added: number
        modified: number
        removed: number
      }
      toast.success(`Synced: ${added} added, ${modified} updated, ${removed} removed`)
      router.refresh()
    } catch {
      toast.error('Sync failed. Try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleSync} disabled={pending}>
      {pending ? 'Syncing…' : 'Sync now'}
    </Button>
  )
}
```

- [ ] **Step 3: Upgrade the accounts page**

Replace the contents of `finance-tracker/web/app/(app)/accounts/page.tsx` with:

```tsx
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/components/empty-state'
import { Card } from '@/components/ui/card'
import { ConnectBankButton } from '@/components/plaid/connect-bank-button'
import { SyncButton } from '@/components/plaid/sync-button'
import type { Account } from '@/lib/types'

export default async function AccountsPage() {
  const supabase = await createClient()
  const { data } = await supabase.from('accounts').select('*').order('name')
  const accounts = (data ?? []) as Account[]

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Accounts</h1>
        <div className="flex gap-2">
          <ConnectBankButton />
          <SyncButton />
        </div>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          title="No linked accounts"
          hint='Click "Connect Bank" to link an account via Plaid, then "Sync now".'
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {a.type} · {a.institution_name}
                </p>
              </div>
              <p className="font-semibold">
                {a.current_balance.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </p>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: build succeeds; the route list includes `/api/create-link-token`, `/api/exchange-token`, `/api/sync`, and `/accounts`.

- [ ] **Step 5: Commit**

```bash
git add finance-tracker/web/components/plaid finance-tracker/web/app/\(app\)/accounts/page.tsx
git commit -m "feat(web): add Connect Bank + Sync UI on the accounts page"
```

---

### Task 12: Full verification, manual smoke test, and docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: build succeeds, no type errors, the three `/api/*` routes and `/accounts` listed.

- [ ] **Step 3: Manual smoke test (requires Supabase + Plaid sandbox)**

This step is performed by the human operator:

1. Apply `finance-tracker/web/supabase/migrations/0002_plaid.sql` in the Supabase dashboard SQL Editor. Verify `plaid_items` exists with RLS, `accounts` has `item_id` (and no `encrypted_plaid_access_token`), and `transactions` has `plaid_transaction_id`.
2. In `finance-tracker/web/.env.local`, fill `PLAID_CLIENT_ID` and `PLAID_SECRET` (sandbox keys from the Plaid dashboard), keep `PLAID_ENV=sandbox`, and set `PLAID_TOKEN_ENC_KEY` to the output of `openssl rand -base64 32`.
3. `npm run dev` → sign in → go to `/accounts`.
4. Click **Connect Bank** → in Plaid Link choose any sandbox bank → log in with `user_good` / `pass_good` → finish. The accounts list should populate.
5. Click **Sync now** → toast shows added counts. In Supabase, the `transactions` table has rows with **negative** amounts for expenses, linked to the right account.
6. Click **Sync now** again → second sync reports `0 added` (idempotent — no duplicate rows).

Record the result. If any step fails, fix before continuing.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`, under "## Plans", change the Plan 4 reference to a written, in-progress plan:

```markdown
- Plan 4 — Plaid bank sync (`2026-06-13-plaid-bank-sync.md`) — **in progress** (Route Handlers, encrypted token storage, full delta sync, Connect Bank/Sync UI)
```

Under the "## Web App" section's Plaid notes, add a line:

```markdown
- Plaid: server-only Route Handlers in `app/api/*` (`create-link-token`, `exchange-token`, `sync`). Access token is AES-256-GCM encrypted (`lib/plaid/crypto.ts`, key `PLAID_TOKEN_ENC_KEY`) and stored on `plaid_items`; never returned to the client. Pure logic in `lib/plaid/{map,sync}.ts`. Sandbox login for testing: `user_good` / `pass_good`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark Plaid bank sync plan in progress"
```

---

## Done criteria

- `npx vitest run` green: crypto, map, sync, the three handler suites, and all Plan 3 finance tests.
- `npm run build` succeeds with `/api/create-link-token`, `/api/exchange-token`, `/api/sync`, and `/accounts` in the route list.
- Connecting a Plaid sandbox bank stores an encrypted `plaid_items` row and upserts accounts; the access token never appears in any HTTP response.
- **Sync now** writes transactions with correct signs (expenses negative), advances the cursor, and is idempotent on a second run.
- No webhooks, no styled Plan 5 rendering — those are later plans.
