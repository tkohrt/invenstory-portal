-- Curated list sweeps (P2.5, patch 39; decided on the 10 Nov Tyler-Shane call).
--
-- The Mozilla-list scenario, made a feature: For Granted finds a curated list
-- of opportunities (a LinkedIn funding roundup, a foundation's program page),
-- loads it once, approves the entries into Ground Truth, and the system
-- sweeps every community-member tenant's eligibility against them. Each
-- matching client gets the notification bar and an "Added by For Granted"
-- section; the work is done once and every member benefits.
--
-- Community membership is a per-tenant flag, admin-set for now: the
-- client-facing consent switch waits for the consent copy sign-off (release
-- plan, consent b). It is deliberately NOT the data-learning toggle.

alter table public.tenant
  add column if not exists community_member boolean not null default false;

-- One loaded list. Entries are ledger_overlay rows pointing here.
create table if not exists public.curated_list (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  source_url   text,
  -- The day-one context packet: what FG pulled down for the whole list
  -- (application questions, FAQ highlights, a webinar's gist). Shown to
  -- matched clients beside the entries.
  context_note text,
  created_by   uuid references public.app_user(id),
  created_at   timestamptz not null default now(),
  swept_at     timestamptz
);

alter table public.curated_list enable row level security;
create policy curated_list_admin_select on public.curated_list
  for select using (is_admin());
create policy curated_list_admin_write on public.curated_list
  for all using (is_admin()) with check (is_admin());

-- Entries ride the existing review pipeline: a curated entry is a
-- ledger_overlay proposal like any web-discovery find, approved or rejected
-- in the Ground Truth queue, with its list recorded.
alter table public.ledger_overlay
  add column if not exists curated_list_id uuid references public.curated_list(id) on delete set null;
alter table public.ledger_overlay drop constraint if exists ledger_overlay_provenance_check;
alter table public.ledger_overlay add constraint ledger_overlay_provenance_check
  check (provenance in ('client_surfaced','scout_bot','manual','web_discovery','curated_list'));
create index if not exists ledger_overlay_curated_idx on public.ledger_overlay (curated_list_id)
  where curated_list_id is not null;

-- One tenant matched against one approved entry. Re-sweeps upsert, so a
-- list can be swept again after more entries are approved.
create table if not exists public.curated_match (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  list_id    uuid not null references public.curated_list(id) on delete cascade,
  overlay_id uuid not null references public.ledger_overlay(id) on delete cascade,
  verdict    text not null check (verdict in ('eligible','likely','check')),
  swept_at   timestamptz not null default now(),
  unique (tenant_id, overlay_id)
);

create index if not exists curated_match_tenant_idx on public.curated_match (tenant_id, swept_at desc);
create index if not exists curated_match_list_idx on public.curated_match (list_id);

alter table public.curated_match enable row level security;
create policy curated_match_admin_select on public.curated_match
  for select using (is_admin());
create policy curated_match_admin_write on public.curated_match
  for all using (is_admin()) with check (is_admin());
