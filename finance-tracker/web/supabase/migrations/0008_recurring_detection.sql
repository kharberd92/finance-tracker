-- Recurring detection: link promoted bills to their merchant and remember dismissals.
alter table bills add column if not exists merchant_name text;

create table if not exists recurring_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_name text not null,  -- normalized merchant key
  created_at timestamptz not null default now(),
  unique (user_id, merchant_name)
);

alter table recurring_dismissals enable row level security;

create policy recurring_dismissals_owner on recurring_dismissals
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
