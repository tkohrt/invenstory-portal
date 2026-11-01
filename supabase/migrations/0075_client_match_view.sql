-- A client's own view of its Funder Matches (patch 7 of the 1 November 2026
-- build). Additive: one new table. No existing row changes.
--
-- For Granted's judgments (match_triage) stay admin-only, with reason codes
-- that can become Ground Truth corrections. A client gets a simpler, separate
-- pair, "Worth a look" and "Not for us", here, so neither can overwrite the
-- other and For Granted can see what the client thinks.
--
--   kind       grant (an open call), funder, or lead (a web find)
--   target_id  the row's own id: grant_id, funder_id, or discovered_lead.id
--   state      interested | not_for_us
--   reason     for not_for_us only, one of lib/client-view.ts CLIENT_REASONS

create table if not exists public.client_match_view (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  kind        text not null check (kind in ('grant','funder','lead')),
  target_id   text not null,
  state       text not null check (state in ('interested','not_for_us')),
  reason      text,
  note        text,
  decided_by  uuid references public.app_user(id),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, kind, target_id)
);
create index if not exists client_match_view_tenant_idx on public.client_match_view (tenant_id);

alter table public.client_match_view enable row level security;

-- A client reads and writes its own; For Granted reads every client's.
drop policy if exists client_match_view_own on public.client_match_view;
create policy client_match_view_own on public.client_match_view for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());

-- The switch that lets a client run searches itself is a row in the existing
-- feature_visibility table (feature_key 'funder_search_self'); no change here.
