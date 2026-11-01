-- What kind of money a client is looking for (patch 2 of the 1 November 2026
-- build). Additive: one column, defaulting every existing profile to grants,
-- which is all the search has ever looked for.
--
--   funding_kinds  any of: grants, contracts (tenders, RFPs, expressions of
--                  interest), programs (accelerators, prizes, competitions,
--                  fellowships), investment (impact investment, loans,
--                  recoverable grants). The application keeps it non-empty.
--
-- It decides which searches run (patches 4 and 5), not eligibility.
-- Apply BEFORE deploying patch 2, for the same reason as 0071: the save
-- writes the column.

alter table public.eligibility_profile
  add column if not exists funding_kinds jsonb not null default '["grants"]'::jsonb;

comment on column public.eligibility_profile.funding_kinds is
  'Kinds of money sought: grants, contracts, programs, investment. Decides which sources are searched, not eligibility.';
