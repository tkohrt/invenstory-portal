-- The Inven(s)tory Garden: per-tenant plant identity + achievements.
create table if not exists public.plant_state (
  tenant_id   uuid primary key references public.tenant(id) on delete cascade,
  species     text check (species in ('pothos','monstera','spider')),
  pot         text not null default 'terracotta',
  trinket     text,
  variegation text,
  hidden      boolean not null default false,
  planted_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.plant_state enable row level security;
create policy plant_state_select on public.plant_state for select using (tenant_id = current_tenant_id() or is_admin());
create policy plant_state_write  on public.plant_state for all using (tenant_id = current_tenant_id() or is_admin()) with check (tenant_id = current_tenant_id() or is_admin());

create table if not exists public.achievement (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  key         text not null,
  unlocked_at timestamptz not null default now(),
  unique (tenant_id, key)
);
alter table public.achievement enable row level security;
create policy achievement_select on public.achievement for select using (tenant_id = current_tenant_id() or is_admin());
create policy achievement_write  on public.achievement for all using (tenant_id = current_tenant_id() or is_admin()) with check (tenant_id = current_tenant_id() or is_admin());
