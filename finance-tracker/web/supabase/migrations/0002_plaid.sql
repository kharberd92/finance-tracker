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
