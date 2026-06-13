-- Personal Finance Tracker — initial schema with Row Level Security.
-- Every table is scoped to the authenticated user via user_id.

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings', 'credit', 'investment')),
  current_balance numeric not null default 0,
  institution_name text not null,
  plaid_account_id text,
  encrypted_plaid_access_token text,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid references accounts (id) on delete set null,
  amount numeric not null,                 -- negative = expense, positive = income
  date date not null,
  merchant_name text not null,
  category text not null,
  notes text,
  is_manual boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  monthly_limit numeric not null
);

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  amount numeric not null,
  due_day integer not null,
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  category text not null,
  is_paid boolean not null default false
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  target_date date,
  icon text not null default 'target',
  color_hex text not null default '#16a34a'
);

-- Indexes for the common per-user queries.
create index if not exists idx_accounts_user on accounts (user_id);
create index if not exists idx_transactions_user_date on transactions (user_id, date desc);
create index if not exists idx_budgets_user on budgets (user_id);
create index if not exists idx_bills_user on bills (user_id);
create index if not exists idx_goals_user on goals (user_id);

-- Row Level Security: a user can only see and modify their own rows.
alter table accounts enable row level security;
alter table transactions enable row level security;
alter table budgets enable row level security;
alter table bills enable row level security;
alter table goals enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts', 'transactions', 'budgets', 'bills', 'goals']
  loop
    execute format(
      'create policy %I on %I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t || '_owner', t
    );
  end loop;
end $$;
