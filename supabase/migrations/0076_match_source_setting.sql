-- Sources for Funder Matches (patch 11 of the 1 November 2026 build).
-- Additive: one new table. No existing row changes.
--
-- Each source (lib/sources.ts) is Automatic, On or Off for a client. Automatic
-- is the absence of a row: the Funding Eligibility profile decides. A row is a
-- person's choice, and records whose (set_by_role). For Granted can lock a
-- choice so the client cannot change it; a client never sets a lock.
--
--   source       worldbank | eu_ft | iati | threesixty | canada | web
--                (Ground Truth, "ledger", is always searched and never stored)
--   mode         auto | on | off   (auto is stored only when locked)

create table if not exists public.match_source_setting (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  source       text not null check (source ~ '^[a-z0-9_]{2,40}$' and source <> 'ledger'),
  mode         text not null check (mode in ('auto','on','off')),
  locked       boolean not null default false,
  set_by       uuid references public.app_user(id),
  set_by_role  text not null check (set_by_role in ('admin','client')),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, source),
  check (not locked or set_by_role = 'admin')
);

alter table public.match_source_setting enable row level security;

-- A client reads its own; For Granted reads and writes every client's. The
-- portal writes through the server (service role), which checks the lock.
drop policy if exists match_source_setting_read on public.match_source_setting;
create policy match_source_setting_read on public.match_source_setting for select
  using (tenant_id = current_tenant_id() or is_admin());
drop policy if exists match_source_setting_admin on public.match_source_setting;
create policy match_source_setting_admin on public.match_source_setting for all
  using (is_admin()) with check (is_admin());
