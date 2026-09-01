-- Manual balance history: a third snapshot provenance for balances the user
-- reads off a statement and attests to.
--
-- Reconstruction is transaction-derived, so accounts Plaid sends no
-- transactions for (investments, loans, secondary accounts) reconstruct to
-- nothing, every backfilled month-end covers fewer accounts than an observed
-- capture, and the completeness guard withholds the whole history. The missing
-- numbers are genuinely missing; the only honest source for them is the user.
--
-- 'manual' is stored distinctly from 'observed' so automated writers (the daily
-- capture, the backfill) can recognize a number a human stands behind and never
-- overwrite it. For charting it ranks WITH 'observed': it is real data, not an
-- estimate.
alter table account_balance_snapshots
  drop constraint if exists account_balance_snapshots_source_check;

alter table account_balance_snapshots
  add constraint account_balance_snapshots_source_check
  check (source in ('observed', 'manual', 'reconstructed'));
