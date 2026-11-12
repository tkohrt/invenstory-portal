-- 0083: the reopen recheck (patch 28, 11 Nov 2026).
--
-- The whole point of the save-for-later bucket (0081) was "surfaced to users
-- when those applications are open again" (Shane, 7 Nov). This is the stamp
-- that makes that true: each match run now rechecks the tenant's saved grants
-- against what came back open, stamps the ones whose call is open again, and
-- unstamps the ones that have closed again. The notification bar leads with
-- the stamp (top rung of the ladder decided 10 Nov).

alter table saved_item add column if not exists reopened_at timestamptz;
alter table saved_item add column if not exists reopened_detail jsonb not null default '{}'::jsonb;

comment on column saved_item.reopened_at is
  'Set by the first run that finds this saved grant open again after its saved close date has passed; cleared by a run that no longer finds it open.';
comment on column saved_item.reopened_detail is
  'The live row it matched when stamped: {grant_id, title, close_date, url, award_ceiling}. Display only.';
