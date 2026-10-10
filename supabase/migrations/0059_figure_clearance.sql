-- 0059: Polish's figure audit, cleared by a person (9 October 2026).
--
-- Polish flags any number in an answer that its Story Cards' sources do not
-- hold. A flag stops the answer leaving (Copy, Mark completed, Mark submitted,
-- approving a Standard Answer) until it is fixed or a person clears it. Shane:
-- For Granted and the client may both clear a flag, with an optional reason.
-- This table remembers each clearance: which number, in which piece, who, when
-- and why. Changing the number in the piece makes a new flag; the old
-- clearance no longer applies.
--
-- Additive only: one new table. No existing row changes.

create table if not exists public.figure_clearance (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  draft_id     uuid references public.grant_draft(id) on delete cascade,
  section_id   uuid not null references public.draft_section(id) on delete cascade,
  block_id     uuid not null references public.section_block(id) on delete cascade,
  figure       text not null,
  reason       text,
  cleared_by   uuid references public.app_user(id) on delete set null,
  cleared_role text not null check (cleared_role in ('admin','client')),
  cleared_at   timestamptz not null default now(),
  unique (block_id, figure)
);
create index if not exists figure_clearance_section on public.figure_clearance (tenant_id, section_id);

alter table public.figure_clearance enable row level security;

-- A client reads its own; only For Granted writes through RLS. A client's
-- clearance is saved by the portal's server, scoped to the client's session.
create policy figure_clearance_select on public.figure_clearance for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy figure_clearance_write on public.figure_clearance for all using (is_admin()) with check (is_admin());
