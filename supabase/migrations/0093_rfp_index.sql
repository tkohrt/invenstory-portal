-- 0093: the RFP index (RFP Engine Phase 1, patch 53, 16 Nov 2026).
--
-- Plan: project doc "RFP Engine, Portal Integration and Build Plan (16 November
-- 2026)", section 3. The Open Funder Index pattern: bulk public sources are
-- loaded here on a schedule by a job OUTSIDE Vercel (the fg-rfp-ingest worker,
-- GitHub Actions, service role), and the portal reads the index in
-- milliseconds. Nothing here is tenant data: one shared index of public
-- notices, like funder_profile and funder_grant. The per-tenant results
-- (rfp_eligible, rfp_run) arrive with screenRfp in a later migration.
--
-- Additive only: three new tables and two seed rows. Touches no existing table.

-- ---------------------------------------------------------------- rfp_source
create table if not exists public.rfp_source (
  id            uuid primary key default gen_random_uuid(),
  -- Stable handle the worker looks its source up by ('sam_extract', 'grants_gov').
  key           text not null unique,
  kind          text not null check (kind in
                  ('federal_extract','grants_gov','platform','state_portal','watchlist','licensed')),
  name          text not null,
  -- How the data is fetched, in words (the URL or API it comes from).
  access_route  text not null,
  -- What may be done with a row from this source. A client-facing surface
  -- refuses to render anything that is not cleared for display:
  --   public_data    official data published for programmatic use: index, store, show
  --   public_record  a state or local posting: show, with per-portal judgment
  --   licensed       a paid API: client display needs the written agreement first
  --   leads_only     aggregator text: a lead to trace to the issuer, never scored or shown
  license_class text not null check (license_class in
                  ('public_data','public_record','licensed','leads_only')),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.rfp_source is
  'One row per source feeding the RFP index (0093). license_class decides whether a notice may be shown to a client; enabled=false makes the worker skip the source.';

-- ---------------------------------------------------------------- rfp_notice
create table if not exists public.rfp_notice (
  id                   uuid primary key default gen_random_uuid(),
  source_id            uuid not null references public.rfp_source(id) on delete restrict,
  -- The source's own id for the notice (SAM NoticeId, Grants.gov opportunity id).
  notice_id            text not null,
  solicitation_number  text,
  title                text not null,
  agency               text,
  office               text,
  -- Normalized: solicitation, combined_synopsis, presolicitation, sources_sought,
  -- special_notice, award, justification, amendment, surplus_sale, bundle,
  -- grant, forecast, other. Text, not an enum, so a new connector can add one.
  notice_type          text not null,
  -- The source's own wording, kept because the normalized type loses detail.
  notice_type_raw      text,
  naics                text[] not null default '{}',
  psc                  text,
  -- Normalized set-aside code (SBA, 8A, HZC, SDVOSBC, WOSB, EDWOSB ...); null = none stated.
  set_aside            text,
  set_aside_raw        text,
  posted_at            timestamptz,
  due_at               timestamptz,
  -- True when the source gave a date with no time, so due_at is midnight UTC
  -- of that day and the real hour is unknown.
  due_date_only        boolean not null default false,
  place_of_performance jsonb,
  description          text,
  description_url      text,
  attachments          jsonb not null default '[]'::jsonb,
  -- T1 primary source, T2 aggregator lead, T3 structural signal. Only T1 is scored.
  evidence_tier        text not null default 'T1' check (evidence_tier in ('T1','T2','T3')),
  raw                  jsonb not null default '{}'::jsonb,
  content_hash         text not null,
  first_seen           timestamptz not null default now(),
  -- The last run this notice was written or closed in. For an ACTIVE notice the
  -- true "last seen" is its source's latest successful run in rfp_ingest_run:
  -- unchanged rows are deliberately not rewritten every night (70,000 no-op
  -- updates a night would be pure churn).
  last_seen            timestamptz not null default now(),
  status               text not null default 'active' check (status in ('active','closed','archived')),
  closed_at            timestamptz,
  unique (source_id, notice_id)
);

comment on table public.rfp_notice is
  'The shared RFP index (0093): public contract and grant notices, upserted nightly by fg-rfp-ingest. Untrusted external text: wrap title, agency and description with untrusted() before any prompt, and escape on display. Not tenant data.';

create index if not exists rfp_notice_open_idx   on public.rfp_notice (due_at) where status = 'active';
create index if not exists rfp_notice_posted_idx on public.rfp_notice (posted_at desc) where status = 'active';
create index if not exists rfp_notice_naics_idx  on public.rfp_notice using gin (naics);
create index if not exists rfp_notice_type_idx   on public.rfp_notice (notice_type) where status = 'active';

-- ------------------------------------------------------------ rfp_ingest_run
create table if not exists public.rfp_ingest_run (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.rfp_source(id) on delete cascade,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  -- running: started and not finished (a run still 'running' hours later died).
  -- ok: everything written. partial: written, but something was held back
  -- (named in errors). failed: nothing trustworthy was written.
  status        text not null default 'running' check (status in ('running','ok','partial','failed')),
  seen          integer not null default 0,
  new_count     integer not null default 0,
  updated_count integer not null default 0,
  reopened_count integer not null default 0,
  closed_count  integer not null default 0,
  unchanged     integer not null default 0,
  errors        jsonb not null default '[]'::jsonb,
  detail        jsonb not null default '{}'::jsonb
);

comment on table public.rfp_ingest_run is
  'One row per source per ingestion run (0093): counts, duration, errors. The Monday digest reads it for ingestion health, so a stale source is caught within a week.';

create index if not exists rfp_ingest_run_source_idx on public.rfp_ingest_run (source_id, started_at desc);

-- ------------------------------------------------------------------- access
-- For Granted reads; the worker writes with the service role (which bypasses
-- RLS). Clients never read these tables directly: client-facing surfaces go
-- through the server, which checks license_class first.
alter table public.rfp_source     enable row level security;
alter table public.rfp_notice     enable row level security;
alter table public.rfp_ingest_run enable row level security;

create policy rfp_source_admin_select     on public.rfp_source     for select using (is_admin());
create policy rfp_source_admin_write      on public.rfp_source     for all using (is_admin()) with check (is_admin());
create policy rfp_notice_admin_select     on public.rfp_notice     for select using (is_admin());
create policy rfp_ingest_run_admin_select on public.rfp_ingest_run for select using (is_admin());

-- --------------------------------------------------------------------- seed
insert into public.rfp_source (key, kind, name, access_route, license_class) values
  ('sam_extract', 'federal_extract', 'SAM.gov Contract Opportunities (nightly extract)',
   'https://sam.gov/data-services: ContractOpportunitiesFullCSV.csv, public, no key', 'public_data'),
  ('grants_gov', 'grants_gov', 'Grants.gov (posted and forecasted)',
   'https://api.grants.gov/v1/api/search2 and fetchOpportunity, public, no key', 'public_data')
on conflict (key) do nothing;
