-- Net worth history: per-account balance snapshots. Net worth stays computed
-- at query time from these rows, so the liability rule can change without
-- invalidating stored history.
create table if not exists account_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  as_of date not null,
  balance numeric not null,
  source text not null check (source in ('observed', 'reconstructed')),
  created_at timestamptz not null default now(),
  unique (account_id, as_of)
);

-- Every read is "this user's series over a date range".
create index if not exists account_balance_snapshots_user_date
  on account_balance_snapshots (user_id, as_of);

alter table account_balance_snapshots enable row level security;

create policy account_balance_snapshots_owner on account_balance_snapshots
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
