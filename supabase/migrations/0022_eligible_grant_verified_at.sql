-- Freshness a client can act on.
--
-- The results table previously carried a single banner naming the source
-- dataset and its snapshot date. Clients should never see that seam: they are
-- working with For Granted's Ground Truth, and how it is assembled is not their
-- concern. Per-record verification is both more honest and more useful, because
-- it says who checked what, and when.
--
-- Null means nobody has confirmed the record at the funder's own site yet.
alter table public.eligible_grant add column if not exists verified_at timestamptz;
comment on column public.eligible_grant.verified_at is
  'When For Granted last confirmed this record at the source. Null = not independently verified.';
