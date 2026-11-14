-- The eligibility feedback loop (patch 44; Shane's priority, 14 Nov).
--
-- Every "Not for us" reason a client gives now teaches the system, and the
-- class the screen should have caught (location, eligibility) is recorded as
-- a miss: the grant's own text, the client's profile at that moment, and the
-- claimed reason. This table is the regression corpus the screen's rules are
-- tuned against; a miss reported once becomes a test case forever.

create table if not exists public.screen_miss (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  kind        text not null check (kind in ('grant','funder','lead')),
  target_id   text not null,
  title       text,
  reason      text not null,              -- the client's CLIENT_REASONS code
  note        text,
  eligibility_text text,                  -- the text the screen judged, as it stood
  profile     jsonb,                      -- the client's eligibility profile at report time
  created_at  timestamptz not null default now()
);

create index if not exists screen_miss_tenant_idx on public.screen_miss (tenant_id, created_at desc);
create index if not exists screen_miss_reason_idx on public.screen_miss (reason);

alter table public.screen_miss enable row level security;
create policy screen_miss_admin_select on public.screen_miss
  for select using (is_admin());
create policy screen_miss_admin_write on public.screen_miss
  for all using (is_admin()) with check (is_admin());

-- Two facts the hardened screen can use when known. Null means unknown and
-- fires no rule; the 990 importer fills founded_year when it can.
alter table public.eligibility_profile
  add column if not exists founded_year int,
  add column if not exists audited_financials boolean;
