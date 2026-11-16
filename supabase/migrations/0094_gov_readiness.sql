-- 0094: Government readiness, the RFP Engine's gate profile (patch 53, 16 Nov 2026).
--
-- Plan: project doc "RFP Engine, Portal Integration and Build Plan (16 November
-- 2026)", section 2. When For Granted turns the RFP Engine on for a client
-- (feature_visibility key 'rfp_engine', no schema change), the client's Funding
-- Eligibility page grows a "Government readiness" section: the six gates as
-- structured answers a person confirmed. This table holds them, one row per
-- client, apart from eligibility_profile so that saving one never touches the
-- other (and an unapplied migration never breaks the eligibility save).
--
-- It also holds the answer to the one interest question every client is asked
-- ("Do you sell, or want to sell, to government buyers?"), which raises a row
-- in the Requests inbox and never turns anything on by itself.
--
-- Additive only: one new table. Touches no existing table or data.

create table if not exists public.gov_readiness (
  tenant_id    uuid primary key references public.tenant(id) on delete cascade,
  -- 'yes' | 'no', or null when not asked or not answered.
  interest     text check (interest in ('yes','no')),
  interest_by  uuid references public.app_user(id) on delete set null,
  interest_at  timestamptz,
  -- The six gates. Shape and rules: lib/gov-readiness.ts (pure, tested).
  -- A gate that is absent is UNANSWERED and screens as "check", never "fail".
  answers      jsonb not null default '{}'::jsonb,
  updated_by   uuid references public.app_user(id) on delete set null,
  updated_at   timestamptz not null default now()
);

comment on table public.gov_readiness is
  'Per-client government readiness (0094): the interest answer and the six RFP gates (SAM registration, facility clearance, CMMC, FedRAMP, GSA Schedule, set-aside statuses), each confirmed by a person and stamped with who and when. Read through lib/gov-readiness.ts; unanswered means check, never fail.';

alter table public.gov_readiness enable row level security;
create policy gov_readiness_select on public.gov_readiness for select
  using (tenant_id = current_tenant_id() or is_admin());
-- Writes go through the server (lib/server/gov-readiness-actions.ts, service
-- role), which validates every answer; a client never writes this row directly.
create policy gov_readiness_write on public.gov_readiness for all
  using (is_admin()) with check (is_admin());
