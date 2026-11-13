-- The shared funder profile (patch 41; decided 13 Nov).
--
-- One record per funder that every client's dossier reads LIVE, so a fact For
-- Granted learns once reaches every dossier at once instead of drifting in
-- per-tenant matched_funder snapshots. This is the funder-side twin of the
-- grants overlay: the Ground Truth review queue stays the single gate, and
-- approving a funder row now also merges its recognized fields in here.
--
-- fields:     the facts themselves (giving_cycle, programs, geography,
--             application_process, assets_usd, annual_giving_usd, fy_year...),
--             only ever filled from a source that stated them.
-- field_meta: per-field provenance {field: {how, source_url, at}}, because
--             "Giving cycle confirmed 13 Nov" must be claimable per fact, not
--             per record.

create table if not exists public.funder_profile (
  -- Normalized EIN when the funder has one, else the ledger funder id
  -- (international and IATI funders).
  funder_key text primary key,
  ein        text,
  fields     jsonb not null default '{}'::jsonb,
  field_meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists funder_profile_ein_idx on public.funder_profile (ein) where ein is not null;

alter table public.funder_profile enable row level security;
create policy funder_profile_admin_select on public.funder_profile
  for select using (is_admin());
create policy funder_profile_admin_write on public.funder_profile
  for all using (is_admin()) with check (is_admin());
