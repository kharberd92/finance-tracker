# Plaid Bank Sync — Design (Plan 4)

**Date:** 2026-06-13
**Status:** Approved design — ready for implementation planning (Plan 4)
**Builds on:** `2026-06-11-finance-tracker-web-design.md` (web app foundation, Plan 3).
Reuses the Plaid call shapes from the Plan 1 serverless backend (`finance-tracker/backend/`).

## Overview

Plan 4 makes bank data flow into the app. It ports the three Plaid proxy
endpoints from the Plan 1 backend into the Next.js app as **secure, persistent**
Route Handlers, adds a schema for storing Plaid connections, and wires a minimal
client UI so the whole chain can be verified end-to-end against Plaid sandbox:

> Connect Bank → Plaid Link → exchange token → **encrypt + store server-side** →
> manual **Sync now** → write accounts + transactions into Supabase.

This is a **full vertical slice**: enough UI to drive and prove the flow. The
styled accounts/transactions experience (lists, filters, dashboard widgets)
remains **Plan 5**. Plaid webhooks / automatic sync are **out of scope** (a clean
follow-up once manual sync is solid).

### Goals
- Three Route Handlers (`create-link-token`, `exchange-token`, `sync`) that derive
  identity from the Supabase session and never return the Plaid access token to
  the client.
- A `plaid_items` table owning the encrypted access token and the sync cursor.
- Correct incremental sync: full `added` / `modified` / `removed` delta handling,
  looping until `has_more` is false, idempotent on re-sync.
- Minimal `/accounts` UI: **Connect Bank** and **Sync now**.
- Unit tests (crypto, mappers, sync loop, handlers) with Plaid + Supabase mocked.

### Non-goals (deferred)
- Plaid webhooks / background auto-sync.
- Styled account & transaction rendering, filters, dashboard widgets (Plan 5).
- Recurring-transaction / bill detection from Plaid (Plan 5+).
- Removing the original `finance-tracker/backend/` (left as reference until the
  web flow is verified working).

## Architecture

Everything lives in `finance-tracker/web/`. Thin Route Handlers delegate the
fiddly logic to pure, unit-testable functions — mirroring the Plan 3 pattern
(pure money math in `lib/finance/`).

```
finance-tracker/web/
  app/api/
    create-link-token/route.ts   # POST → { linkToken }            (user from session)
    exchange-token/route.ts      # POST { publicToken } → store Item + upsert accounts
    sync/route.ts                # POST → full delta sync → { added, modified, removed }
  lib/plaid/
    client.ts                    # TS port of createPlaidClient (env-driven)
    crypto.ts                    # AES-256-GCM encrypt/decrypt (Web Crypto)  [pure, tested]
    map.ts                       # Plaid account/txn → our rows               [pure, tested]
    sync.ts                      # transactionsSync loop + delta application  [pure, tested]
  components/plaid/
    connect-bank-button.tsx      # client: react-plaid-link → exchange-token
    sync-button.tsx              # client: POST /api/sync, toast result
  app/(app)/accounts/page.tsx    # upgraded: Server Component lists items/accounts + buttons
  lib/types.ts                   # +PlaidItem; Account gains item_id, loses encrypted token
  supabase/migrations/0002_plaid.sql
  .env.local.example             # +PLAID_TOKEN_ENC_KEY; PLAID_* filled with sandbox creds
```

**Dependencies added:** `plaid` (server SDK), `react-plaid-link` (client Link wrapper).

**Design principles:**
- **Security first.** Handlers resolve the user via `supabase.auth.getUser()`;
  `client_user_id` for Plaid = `user.id`. The request body is never trusted for
  identity. The access token is encrypted before storage and decrypted only
  inside the sync handler — it never crosses the wire to the browser.
- **Thin handler / pure core.** Handlers do: auth → call Plaid → call pure
  mappers → write Supabase → return JSON. All sign flips, category/type mapping,
  and delta application are pure functions with no Plaid/Supabase imports.

## Data flow

1. **Connect Bank** (`/accounts`) → client `fetch`es `POST /api/create-link-token`
   → opens Plaid Link with the returned `link_token`.
2. Plaid Link returns a `publicToken` → client posts it to `POST /api/exchange-token`.
   The handler exchanges it for an access token + `item_id`, **encrypts** the
   token, inserts a `plaid_items` row (with `institution_name`), then immediately
   `accountsBalanceGet` + **upserts the accounts**. Returns `{ ok, accountCount }`.
3. **Sync now** → `POST /api/sync` (no client input). For each of the user's
   `plaid_items`: decrypt token, loop `transactionsSync({ cursor })` until
   `has_more` is false, apply deltas to Supabase, refresh balances, save the new
   cursor. Returns `{ added, modified, removed }` counts.

All client `fetch` calls use an `AbortController` timeout so the UI never hangs.

## Database schema (`0002_plaid.sql`)

Additive migration; same RLS `*_owner` pattern as `0001`. Applied via the
Supabase SQL Editor (like `0001`).

**1. New `plaid_items`** — one row per bank login; owns token + cursor:
```sql
create table plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_item_id text not null,
  encrypted_access_token text not null,   -- AES-256-GCM ciphertext, never plaintext
  sync_cursor text,                        -- transactionsSync bookmark; null until first sync
  institution_name text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, plaid_item_id)
);
-- RLS enabled + plaid_items_owner policy (user_id = auth.uid()), matching 0001.
```

**2. `accounts`** — link to Item, drop per-account token, add upsert key:
```sql
alter table accounts add column item_id uuid references plaid_items(id) on delete cascade;
alter table accounts drop column encrypted_plaid_access_token;   -- empty today; safe to drop
alter table accounts add constraint accounts_user_plaid_acct_unique unique (user_id, plaid_account_id);
```

**3. `transactions`** — Plaid id as the delta-matching / idempotency key:
```sql
alter table transactions add column plaid_transaction_id text;
alter table transactions add constraint transactions_user_plaid_txn_unique unique (user_id, plaid_transaction_id);
```
Nullable, so manual transactions (`is_manual = true`) need no Plaid id.

**Type changes (`lib/types.ts`):** add `PlaidItem`; on `Account`, replace
`encrypted_plaid_access_token?` with `item_id?: string | null`; on `Transaction`,
add `plaid_transaction_id?: string | null`.

## Handlers

### `POST /api/create-link-token`
Resolve user → `linkTokenCreate({ user: { client_user_id: user.id }, client_name,
products: ['transactions'], country_codes: ['US'], language: 'en' })` → `{ linkToken }`.

### `POST /api/exchange-token`
Body `{ publicToken }` (Zod). Resolve user →
`itemPublicTokenExchange` → encrypt access token → insert `plaid_items` (with
institution name from an `itemGet` → `institutionsGetById` lookup) →
`accountsBalanceGet` → upsert accounts for the item → `{ ok: true, accountCount }`.
**No token in the response.**

### `POST /api/sync`
No client input. For each `plaid_items` row owned by the user:
decrypt token → loop `transactionsSync({ access_token, cursor })` until
`has_more` is false, accumulating added/modified/removed → apply deltas to
Supabase (keyed by `(user_id, plaid_transaction_id)`): added → upsert,
modified → update, removed → delete → `accountsBalanceGet` + upsert accounts →
save final `next_cursor` to the item. Returns `{ added, modified, removed }`.

The loop + delta application is a pure function in `lib/plaid/sync.ts` taking
"fetch page" and "apply" callbacks, so it is testable without real Plaid/Supabase.

## Data mapping (`lib/plaid/map.ts`, pure)

| Our field | From Plaid | Rule |
|---|---|---|
| `transactions.amount` | `txn.amount` | **Sign flipped**: `amount = -txn.amount` (Plaid positive = money out; we store negative = expense). |
| `transactions.date` | `txn.date` | ISO `YYYY-MM-DD`. |
| `transactions.merchant_name` | `txn.merchant_name ?? txn.name` | Fallback to raw name. |
| `transactions.category` | `txn.personal_finance_category.primary` | Title-cased (`FOOD_AND_DRINK` → `Food And Drink`); `'Uncategorized'` if absent. |
| `transactions.account_id` | `txn.account_id` | Resolved to our `accounts.id` via `plaid_account_id`. |
| `transactions.plaid_transaction_id` | `txn.transaction_id` | Delta-matching / idempotency key. |
| `transactions.is_manual` | — | Always `false` for synced rows. |
| `accounts.type` | `account.type` / `subtype` | `depository+checking→checking`, `depository+savings→savings`, `credit→credit`, `investment`/`brokerage`→`investment`, `loan→credit`, unknown→`checking`. |
| `accounts.current_balance` | `account.balances.current` | Numeric. |
| `accounts.name` | `account.name` | — |
| `accounts.institution_name` | institution lookup | Stored on the item; copied to accounts. |

The sign flip aligns with `lib/finance/budget.ts` (`amount < 0` = expense) from
Plan 3 — a $40 grocery charge stores as `-40`.

## Error handling & security

- **401** when `getUser()` finds no session (every handler). Identity from session only.
- **400** on Zod validation failure (bad/missing body).
- **502** on any Plaid error — generic message, no Plaid internals leaked.
- **500** on a Supabase/DB error — generic message.
- Secrets (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_TOKEN_ENC_KEY`) are
  server-only env vars (no `NEXT_PUBLIC_` prefix). The access token is AES-256-GCM
  encrypted at rest and decrypted only inside `/api/sync`.
- `PLAID_TOKEN_ENC_KEY` is a 32-byte key (`openssl rand -base64 32`), added to
  `.env.local` and the Vercel environment.

## Testing strategy

Vitest, all Plaid/Supabase calls mocked (no real network):
- **`crypto.test.ts`** — encrypt→decrypt round-trip; ciphertext ≠ plaintext;
  tampered ciphertext fails to decrypt.
- **`map.test.ts`** — sign flip, category title-case + fallback, account-type
  cases, merchant fallback.
- **`sync.test.ts`** — multi-page `has_more` loop; added/modified/removed applied
  correctly; cursor advances to the final `next_cursor`.
- **Handler tests** — per handler: 401 unauthenticated, 400 bad body, 502 on
  Plaid error, success path writes the expected rows (clients mocked).

**Manual verification** (Plan 3-style smoke test):
1. Apply `0002_plaid.sql` in the Supabase SQL Editor.
2. Fill `PLAID_CLIENT_ID` / `PLAID_SECRET` (sandbox) + `PLAID_TOKEN_ENC_KEY` in `.env.local`.
3. `npm run dev` → `/accounts` → **Connect Bank** → Plaid sandbox login
   (`user_good` / `pass_good`).
4. **Sync now** → confirm accounts + transactions appear in Supabase with correct
   signs (expenses negative), no duplicates on a second sync.

## Done criteria
- `npx vitest run` green (crypto, map, sync, handler suites + existing Plan 3 tests).
- `npm run build` succeeds.
- Connecting a Plaid sandbox bank stores an encrypted `plaid_items` row and upserts
  accounts; the access token never appears in any HTTP response.
- **Sync now** writes/updates/removes transactions correctly, advances the cursor,
  and is idempotent (a second sync with no new data changes nothing).
- No webhooks, no styled Plan 5 rendering — those are later plans.
