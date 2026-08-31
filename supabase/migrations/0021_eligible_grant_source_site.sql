-- `source` from the Ledger is where a record was listed, not who funds it.
-- Keeping the two apart so the funder column can be honest, and blank when we
-- genuinely do not know yet.
alter table public.eligible_grant add column if not exists source_site text;
comment on column public.eligible_grant.source_site is
  'Where the opportunity was listed (scrape origin). Never present this as the funder.';
