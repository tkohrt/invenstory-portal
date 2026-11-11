-- 0082: per-run new results (patch 27, 11 Nov 2026).
--
-- The history rail's read-only run summaries (decided 10 Nov) need each run to
-- remember what it found that was not cached before it. first_matched_at on
-- eligible_grant cannot answer this for past runs: those rows are swept. The
-- run record is the durable place, so the run records it. Additive; old rows
-- read as empty.

alter table match_run add column if not exists new_ids jsonb not null default '[]'::jsonb;
alter table match_run add column if not exists new_titles jsonb not null default '[]'::jsonb;

comment on column match_run.new_ids is
  'Grant ids this run returned that were not cached before it (up to 50). The durable record of what each search newly found.';
comment on column match_run.new_titles is
  'Up to ten titles of those new grants, so a run summary can NAME what was new without a join against rows that may be swept.';
