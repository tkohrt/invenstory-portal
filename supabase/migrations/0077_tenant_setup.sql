-- Company setup on first sign-in (patch 14, onboarding build, 3 November 2026).
-- Additive: one new table, plus a backfill so no current client is sent into setup.
--
-- One row per client organization. No row means a client made after this
-- migration that has not started setup: the portal treats it as "in progress,
-- not yet claimed". The first client user to sign in claims it (owner_user_id)
-- and is the only person taken through the eight steps; teammates see a note.
--
--   steps     {"you":"done","layer2":"skipped",...}   (lib/setup.ts SETUP_STEPS)
--   answers   role, known_funders, deadlines, invites, goal  (cleaned in lib/setup.ts)
--   legacy    true for clients that existed before this build (marked complete)
--
-- Run this ONCE. The backfill marks every tenant without a row as complete, so
-- running it again later would also mark clients made since then (who have no
-- row until their first sign-in) as set up, and they would skip setup.

create table if not exists public.tenant_setup (
  tenant_id      uuid primary key references public.tenant(id) on delete cascade,
  owner_user_id  uuid references public.app_user(id) on delete set null,
  status         text not null default 'in_progress' check (status in ('in_progress','complete')),
  steps          jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  answers        jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  layer3_read_at timestamptz,
  legacy         boolean not null default false,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now()
);

alter table public.tenant_setup enable row level security;

-- A client reads its own; For Granted reads and writes all. The portal writes
-- through the server (service role), which checks who is allowed.
drop policy if exists tenant_setup_read on public.tenant_setup;
create policy tenant_setup_read on public.tenant_setup for select
  using (tenant_id = current_tenant_id() or is_admin());
drop policy if exists tenant_setup_admin on public.tenant_setup;
create policy tenant_setup_admin on public.tenant_setup for all
  using (is_admin()) with check (is_admin());

-- Every client that exists today is already set up.
insert into public.tenant_setup (tenant_id, status, legacy, completed_at)
select t.id, 'complete', true, now()
from public.tenant t
on conflict (tenant_id) do nothing;
