-- One row per match run, so a bad result can be diagnosed rather than argued
-- about.
--
-- Runs have been a black box. When a shortlist came back wrong there was no way
-- to tell whether the retrieval was wrong, the query was wrong, or the document
-- behind the query was wrong, which turned every quality question into an
-- opinion. This records what was actually asked.
--
-- `queries` is the exact text sent to each index. That is the single most
-- useful thing to have when a run disappoints, and it costs nothing to keep.

create table if not exists public.match_run (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  ran_at          timestamptz not null default now(),
  ran_by          uuid references public.app_user(id),

  -- What was asked: [{track: "grants"|"funders", text: "..."}]
  queries         jsonb not null default '[]'::jsonb,
  -- Was the Inven(s)tory used, or did this fall back to the eligibility form?
  used_profile    boolean not null default false,
  -- Several angles per track, or one. Kept so two runs can be compared.
  multi_query     boolean not null default true,
  -- What the Search Profile said about itself at the time.
  profile_note    text,

  kept            integer not null default 0,
  dropped         integer not null default 0,
  funders         integer not null default 0
);

comment on table public.match_run is
  'Per-run diagnostics for funder matching. Records the exact query text so a disappointing run can be diagnosed rather than guessed at.';

create index if not exists match_run_tenant_idx on public.match_run (tenant_id, ran_at desc);

alter table public.match_run enable row level security;
create policy match_run_select on public.match_run for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy match_run_write on public.match_run for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
