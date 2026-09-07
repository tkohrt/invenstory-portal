-- When a match FIRST appeared, as distinct from when it was last confirmed.
--
-- The question is "which of these are new since the last run", and matched_at
-- cannot answer it. A run is a snapshot: every surviving row is stamped with
-- the same ranAt and anything the run did not return is swept. So matched_at is
-- identical on every row in the table, always, and a "date of match" column
-- built on it would show one repeated date and answer nothing.
--
-- first_matched_at is set once, by the column default, when a row is inserted.
-- The upsert never lists it, so a row that survives a later run keeps its
-- original value while matched_at moves. New rows stand out; long-standing ones
-- carry the date they arrived.
--
-- Honest limit: a match that drops out of a run and returns later is swept in
-- between, so it comes back as new. That is "first seen in the current
-- unbroken run of appearances", which is the useful reading anyway, since an
-- opportunity that vanished and returned is worth a fresh look.

alter table public.eligible_grant
  add column if not exists first_matched_at timestamptz not null default now();

alter table public.matched_funder
  add column if not exists first_matched_at timestamptz not null default now();

comment on column public.eligible_grant.first_matched_at is
  'When this opportunity first appeared for this client. Set on insert and never updated, so it survives later runs while matched_at moves.';
comment on column public.matched_funder.first_matched_at is
  'When this funder first appeared for this client. Set on insert and never updated.';

-- Existing rows: the migration default backfills them with now(), which would
-- claim everything currently on screen arrived today. Better to say they date
-- from the run that put them there.
update public.eligible_grant set first_matched_at = matched_at where matched_at is not null;
update public.matched_funder set first_matched_at = matched_at where matched_at is not null;
