-- One-time backfill: normalize legacy transaction categories to the controlled
-- vocabulary in lib/finance/categories.ts.
--
-- Some seeded/legacy rows stored humanized Plaid primary labels (e.g.
-- "Transfer Out", "Loan Payments") that bypassed mapPlaidCategory. Because
-- category-based features match the controlled values exactly, these rows were
-- silently excluded from the controlled vocabulary — e.g. cashflow transfer
-- exclusion (category = 'Transfer') and budget matching never recognized them.
--
-- Each mapping below is exactly what mapPlaidCategory would have produced for
-- the corresponding Plaid primary. Idempotent: only rewrites the listed
-- non-conforming values, so re-running is a no-op. Already-valid categories
-- (Transportation, Food And Drink, Travel, Bills & Utilities, Groceries,
-- Income, etc.) are left untouched.

update transactions set category = 'Transfer'
  where category in ('Transfer In', 'Transfer Out');

update transactions set category = 'Bills & Utilities'
  where category in ('Loan Payments', 'Rent And Utilities');

update transactions set category = 'Health'
  where category = 'Personal Care';

update transactions set category = 'Shopping'
  where category = 'General Merchandise';
