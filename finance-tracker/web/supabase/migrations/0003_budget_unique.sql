-- One budget per category per user. Enables saveBudget to upsert on conflict.
alter table budgets add constraint budgets_user_category_unique unique (user_id, category);
