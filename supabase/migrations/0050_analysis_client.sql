-- 0050_analysis_client.sql
--
-- Inven(s)tory Analysis, Phase C: the client's own path (Build Decisions, 2
-- October 2026, decisions 2 and 4).
--
-- What this makes possible:
--   * A client presses Analyze my Inven(s)tory themselves. Each press is
--     recorded with how much new text it was about to read, so a fair-use cap
--     (one analysis a day, a monthly page allowance) can be checked before any
--     paid read starts. Analyses For Granted runs are not recorded here and never
--     count against a client's allowance.
--   * Past the cap the button becomes Request an analysis. The request waits
--     here for For Granted to approve (and run) or decline it.
--   * Each Funding Eligibility answer the analysis found is confirmed or turned
--     down by the client, one by one; nothing is saved to the profile silently.
--     A turned-down answer is remembered so it is not suggested again.
--   * When the client has been through every answer, the moment is stamped:
--     "eligibility confirmed" is one of the two conditions for Funder Matches.
--
-- The whole client path is behind a per-client switch (feature_visibility,
-- key 'analysis'), off for every client until For Granted turns it on.
--
-- ADDITIVE. Four new tables, no existing row or column changes. Reversible by
-- dropping them. Writes go through server actions on the service client, which
-- check the session; the policies below are the second guard.

create table if not exists public.analysis_usage (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  job_id         uuid references public.job(id) on delete set null,
  started_by     uuid references public.app_user(id),
  pending_docs   int not null default 0,      -- documents the run was about to read
  pending_chars  int not null default 0,      -- their text length, for the page allowance
  via_request    uuid,                        -- the approved request this run used, if any
  created_at     timestamptz not null default now()
);
create index if not exists analysis_usage_tenant_at on public.analysis_usage (tenant_id, created_at desc);

create table if not exists public.analysis_request (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  requested_by uuid references public.app_user(id),
  note         text,
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  decided_by   uuid references public.app_user(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists analysis_request_tenant on public.analysis_request (tenant_id, created_at desc);

create table if not exists public.analysis_suggestion_decision (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  field       text not null,                  -- eligibility field, e.g. 'ein', 'state_code'
  value_key   text not null,                  -- the normalised value decided on
  decision    text not null check (decision in ('confirmed','rejected')),
  decided_by  uuid references public.app_user(id),
  decided_at  timestamptz not null default now(),
  primary key (tenant_id, field, value_key)
);

create table if not exists public.analysis_client_state (
  tenant_id                 uuid primary key references public.tenant(id) on delete cascade,
  eligibility_confirmed_at  timestamptz,
  eligibility_confirmed_by  uuid references public.app_user(id)
);

alter table public.analysis_usage               enable row level security;
alter table public.analysis_request             enable row level security;
alter table public.analysis_suggestion_decision enable row level security;
alter table public.analysis_client_state        enable row level security;

-- A client reads its own tenant's rows; an admin reads every row. Only admins
-- write through RLS (the server actions write through the service client).
create policy analysis_usage_select on public.analysis_usage for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy analysis_usage_write on public.analysis_usage for all
  using (is_admin()) with check (is_admin());

create policy analysis_request_select on public.analysis_request for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy analysis_request_write on public.analysis_request for all
  using (is_admin()) with check (is_admin());

create policy analysis_suggestion_decision_select on public.analysis_suggestion_decision for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy analysis_suggestion_decision_write on public.analysis_suggestion_decision for all
  using (is_admin()) with check (is_admin());

create policy analysis_client_state_select on public.analysis_client_state for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy analysis_client_state_write on public.analysis_client_state for all
  using (is_admin()) with check (is_admin());
