-- Bills: support quarterly/yearly anchoring and auto-resetting paid status.
alter table bills add column due_month smallint;      -- anchor month (1–12) for quarterly/yearly
alter table bills add column last_paid_date date;      -- null = unpaid this cycle
alter table bills drop column is_paid;                 -- replaced by last_paid_date
