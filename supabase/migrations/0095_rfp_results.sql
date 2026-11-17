-- 0095: RFP Engine results (patch 54, 17 Nov 2026).
--
-- Plan: project doc "RFP Engine, Portal Integration and Build Plan (16 November
-- 2026)", sections 3 and 4. Three tables:
--   rfp_eligible    per-client results cache, the eligible_grant analog. One
--                   row per client per notice, holding the Rubric v1.1 verdict.
--   rfp_run         per-client run record, the match_run analog.
--   rfp_golden_run  each run of the 20-row golden set (the BKL re-run of 12 Nov
--                   2026). Not tenant data. No rubric or prompt change ships
--                   unless the latest golden run holds the 80% bar.
--
-- Additive only: three new tables. Touches no existing table or data.

-- ------------------------------------------------------------------ rfp_run
create table if not exists public.rfp_run (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running','ok','partial','failed')),
  -- 'cron' (the weekly scan) or 'admin' (run by hand from the client page).
  trigger         text not null default 'admin' check (trigger in ('cron','admin')),
  rubric_version  text not null,
  candidates      integer not null default 0,   -- notices the candidate pull returned
  screened_out    integer not null default 0,   -- removed by rules before any model call
  scored          integer not null default 0,   -- model fit calls made
  counts          jsonb not null default '{}'::jsonb,  -- per action bucket
  new_ids         uuid[] not null default '{}',  -- rfp_notice ids new to this client
  new_titles      text[] not null default '{}',
  swept           integer not null default 0,   -- earlier results this run replaced
  query_log       jsonb not null default '{}'::jsonb,
  errors          jsonb not null default '[]'::jsonb
);
create index if not exists rfp_run_tenant_idx on public.rfp_run (tenant_id, started_at desc);

alter table public.rfp_run enable row level security;
create policy rfp_run_select on public.rfp_run for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy rfp_run_write on public.rfp_run for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------------- rfp_eligible
create table if not exists public.rfp_eligible (
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  notice_id       uuid not null references public.rfp_notice(id) on delete cascade,
  run_id          uuid references public.rfp_run(id) on delete set null,
  rubric_version  text not null,
  -- The verdict (lib/rfp-rubric.ts): bid, lean_bid, answer, pass, skip_team,
  -- watch, watch_gate_plan, track_recompete, cannot_score.
  action          text not null,
  -- The five buckets a client sees: draft_submit, open_response, no_source,
  -- spend_nothing, upcoming.
  bucket          text not null check (bucket in ('draft_submit','open_response','no_source','spend_nothing','upcoming')),
  fit             text check (fit in ('High','Medium','Low')),
  fit_provisional boolean not null default false,
  rationale       text,
  -- Quotes the fit rests on: [{ from: 'client'|'notice', text }].
  evidence        jsonb not null default '[]'::jsonb,
  gate_result     text not null check (gate_result in ('open','closed','check')),
  gate_blockers   jsonb not null default '[]'::jsonb,
  gate_checks     jsonb not null default '[]'::jsonb,
  lift_class      text,
  lift_hours      text,
  deal_breaker    text,
  strategic_note  text,
  -- Triage, the same verbs as grants. Client: worth_a_look | not_for_us.
  -- For Granted: pinned | under_review | rejected.
  client_triage   text check (client_triage in ('worth_a_look','not_for_us')),
  admin_triage    text check (admin_triage in ('pinned','under_review','rejected')),
  first_seen_at   timestamptz not null default now(),
  verified_at     timestamptz not null default now(),
  primary key (tenant_id, notice_id)
);
create index if not exists rfp_eligible_bucket_idx on public.rfp_eligible (tenant_id, bucket);

alter table public.rfp_eligible enable row level security;
create policy rfp_eligible_select on public.rfp_eligible for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy rfp_eligible_write on public.rfp_eligible for all
  using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------- rfp_golden_run
create table if not exists public.rfp_golden_run (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  run_by          uuid references public.app_user(id) on delete set null,
  rubric_version  text not null,
  model           text not null,
  -- Action-level agreement on the comparable (T1) rows, and the bar it is held to.
  comparable      integer not null,
  agreed          integer not null,
  agreement       numeric(5,4) not null,
  bar             numeric(5,4) not null default 0.80,
  passed          boolean not null,
  -- Per row: id, expected, got, fit, agreed, rationale.
  rows            jsonb not null default '[]'::jsonb
);

alter table public.rfp_golden_run enable row level security;
create policy rfp_golden_run_admin on public.rfp_golden_run for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------- rfp_golden_profile
-- The golden set's client profile (capabilities, shipped work, commercial
-- terms): the text the live golden run hands the model. Held here and never
-- in the repository, which is public. One row, written by For Granted.
create table if not exists public.rfp_golden_profile (
  id          text primary key default 'golden' check (id = 'golden'),
  profile     text not null,
  updated_at  timestamptz not null default now()
);

alter table public.rfp_golden_profile enable row level security;
create policy rfp_golden_profile_admin on public.rfp_golden_profile for all
  using (is_admin()) with check (is_admin());
