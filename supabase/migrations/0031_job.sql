-- Long work that outlives a request.
--
-- Two actions can now exceed the platform's function limit: a match run makes
-- up to seven calls to a service that naps and allows 150 seconds each, and
-- building a Search Profile is a model call per document window. Both were
-- server actions, which are request/response, so a slow run gave the user a
-- dead spinner and a half-written result with no way to tell which.
--
-- A spinner cannot fix that. This can: the work writes its progress to a row,
-- the page polls the row, and the person can walk away and come back. A run
-- that dies is visibly failed rather than a browser tab that gave up.
--
-- `stalled` is deliberately not a stored status. A killed function cannot
-- update its own row to say it died, so staleness is judged on read from
-- updated_at. Anything else would need a reaper.

create table if not exists public.job (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  kind        text not null check (kind in ('match','search_profile','readiness')),
  status      text not null default 'running' check (status in ('running','done','failed')),

  -- What the person sees while they wait. A sentence, not a spinner label.
  label       text,
  -- Where it has got to. total 0 means the work cannot count itself yet.
  done        integer not null default 0,
  total       integer not null default 0,
  -- The current step, named: "reading Strategic Plan 2026".
  detail      text,

  -- A short summary once finished, so the page can say what happened without
  -- re-running anything.
  result      jsonb,
  error       text,

  started_by  uuid references public.app_user(id),
  started_at  timestamptz not null default now(),
  -- Heartbeat. A running job that has not moved in minutes is presumed dead.
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.job is
  'Progress for work that can outlive a request. Polled by the page; a running job whose updated_at is stale is presumed dead rather than reaped.';

create index if not exists job_tenant_kind_idx on public.job (tenant_id, kind, started_at desc);

alter table public.job enable row level security;
create policy job_select on public.job for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy job_write on public.job for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
