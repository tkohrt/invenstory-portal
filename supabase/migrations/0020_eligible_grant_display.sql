-- Funder matching results were cached with only an id, so the results table
-- rendered raw URLs and lost the funder's name entirely. Cache what a person
-- actually needs to read: what the opportunity is called, who is giving the
-- money, where to verify it, and why we think it fits.
--
-- `rationale` is the grounded explanation: which eligibility-profile facts and
-- which Inven(s)tory documents support the match. It is generated per run and
-- cites only real document titles.

alter table public.eligible_grant add column if not exists title     text;
alter table public.eligible_grant add column if not exists funder    text;
alter table public.eligible_grant add column if not exists url       text;
alter table public.eligible_grant add column if not exists rationale text;

comment on column public.eligible_grant.rationale is
  'Grounded match explanation citing eligibility-profile fields and Inven(s)tory document titles. June 2026 snapshot: a lead, not a fact.';
