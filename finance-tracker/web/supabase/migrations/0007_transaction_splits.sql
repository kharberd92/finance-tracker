-- Transaction splitting: a transaction can be divided across multiple categories.
-- Parent transactions.category is set to 'Split'; the parts live here.
create table if not exists transaction_splits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references transactions (id) on delete cascade,
  category text not null,
  amount numeric not null,      -- same sign as parent (negative = expense)
  created_at timestamptz not null default now()
);

create index if not exists idx_transaction_splits_txn on transaction_splits (transaction_id);
create index if not exists idx_transaction_splits_user on transaction_splits (user_id);

alter table transaction_splits enable row level security;

create policy transaction_splits_owner on transaction_splits
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
