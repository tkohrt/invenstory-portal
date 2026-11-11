-- The run digest (Funding split phase 2, 11 November 2026).
--
-- When a search sweeps away grants that no longer come back (closed, stale,
-- or gone from the sources), they used to vanish silently from the table.
-- The digest reports them ("Search finished: 14 found, 2 new, 1 no longer
-- open"), which needs the sweep recorded at the moment it happens. Additive
-- and safe: existing rows read as zero swept.

alter table match_run add column if not exists swept integer not null default 0;
alter table match_run add column if not exists swept_titles jsonb not null default '[]'::jsonb;

comment on column match_run.swept is
  'How many previously cached grants this run swept away (no longer returned by any source). Reported in the run digest, never silent.';
comment on column match_run.swept_titles is
  'Up to ten titles of the swept grants, so the history can say WHICH dropped off, not just how many.';
