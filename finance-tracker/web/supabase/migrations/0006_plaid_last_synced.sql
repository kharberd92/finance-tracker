-- Track when each Plaid item was last successfully synced (for the daily
-- auto-sync job and the "Last synced" UI label). Nullable: null = never synced.
alter table plaid_items
  add column if not exists last_synced_at timestamptz;
