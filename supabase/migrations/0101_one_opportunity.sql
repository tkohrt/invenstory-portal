-- 0101 One opportunity, one entry (patch 68, 19 November 2026).
--
-- The review queue knew an opportunity by its web address alone, so the same
-- grant seen at two addresses was two entries and a rejected one came back as
-- new when its address or wording moved. These columns let filing recognise a
-- second sighting (lib/opportunity.ts):
--   * opp_host, opp_funder: the two keys candidates are found by, the site of
--     the entry's own link and the funder's name normalised. The expressions
--     below mirror oppHost and funderKey in lib/opportunity.ts; change one
--     and change the other.
--   * also_seen: the other addresses one entry has been sighted at.
--   * update_of: set on a waiting row that proposes changed facts (a moved
--     deadline, a new amount) for an entry already approved. Approving it
--     writes the changes onto that entry; it never becomes a second one.
--
-- Additive, and safe to run more than once (the backfill only fills blanks,
-- from the row's own data).

alter table public.ledger_overlay
  add column if not exists opp_host text,
  add column if not exists opp_funder text,
  add column if not exists also_seen jsonb not null default '[]'::jsonb,
  add column if not exists update_of uuid references public.ledger_overlay(id) on delete set null;

update public.ledger_overlay
   set opp_host = substring(lower(source_url) from '^https?://(?:www\.)?([^/:#?[:space:]]+)')
 where kind = 'grant' and opp_host is null and source_url ~* '^https?://';

update public.ledger_overlay
   set opp_funder = nullif(regexp_replace(regexp_replace(lower(coalesce(fields->>'agency', '')), '^\s*the\s+', ''), '[^a-z0-9]+', '', 'g'), '')
 where kind = 'grant' and opp_funder is null;

create index if not exists ledger_overlay_opp_host_idx on public.ledger_overlay (opp_host) where opp_host is not null;
create index if not exists ledger_overlay_opp_funder_idx on public.ledger_overlay (opp_funder) where opp_funder is not null;
create index if not exists ledger_overlay_update_of_idx on public.ledger_overlay (update_of) where update_of is not null;

notify pgrst, 'reload schema';
