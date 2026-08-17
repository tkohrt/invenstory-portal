-- Funding Eligibility: an "answer once" structured profile the portal matches
-- against funder/grant eligibility to pre-screen opportunities. Ledger-independent
-- to capture; matching (eligible_grant) fills once the Funder Ledger is wired.

create table if not exists public.eligibility_profile (
  tenant_id            uuid primary key references public.tenant(id) on delete cascade,
  applicant_type       text not null default 'organization',   -- organization | individual
  org_type             text,   -- nonprofit_501c3 | for_profit | government | school | tribal | fiscally_sponsored | other
  tax_status           text,   -- none | pending | 501c3 | other
  ein                  text,
  fiscal_sponsor       text,
  state_code           text,
  county               text,
  service_area         jsonb not null default '[]',   -- string[] of state codes
  budget_band          text,   -- lt_100k | 100k_500k | 500k_1m | 1m_5m | 5m_10m | gt_10m
  populations          jsonb not null default '[]',   -- string[]
  cause_areas          jsonb not null default '[]',   -- string[]
  federal_registration text not null default 'none',  -- none | sam_uei_active
  match_capacity_pct   int,
  completeness         int not null default 0,         -- 0..100, computed on save
  updated_by           uuid references public.app_user(id),
  updated_at           timestamptz not null default now()
);
alter table public.eligibility_profile enable row level security;
create policy eligibility_profile_select on public.eligibility_profile for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy eligibility_profile_write on public.eligibility_profile for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());

-- Per-tenant match cache (filled by the matching pipeline once the Ledger is up).
create table if not exists public.eligible_grant (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  grant_id      text not null,
  verdict       text not null check (verdict in ('eligible','likely','check')),
  reason        text,
  close_date    date,
  award_ceiling bigint,
  matched_at    timestamptz not null default now(),
  primary key (tenant_id, grant_id)
);
alter table public.eligible_grant enable row level security;
create policy eligible_grant_select on public.eligible_grant for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy eligible_grant_write on public.eligible_grant for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
