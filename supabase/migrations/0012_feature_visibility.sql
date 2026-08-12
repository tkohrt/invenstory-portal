-- Per-tenant visibility for top-level portal features (currently the Answer
-- Library). Unlike Story Intelligence artifacts (which default visible), these
-- default HIDDEN: a feature is client-visible only when an explicit row exists
-- with visible = true. Absence of a row => hidden. Admins toggle it.
create table if not exists public.feature_visibility (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  feature_key text not null,
  visible     boolean not null default false,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

alter table public.feature_visibility enable row level security;

-- Clients read their own tenant's flags; admins read all.
create policy feature_visibility_select on public.feature_visibility
  for select using (tenant_id = current_tenant_id() or is_admin());

-- Only admins write (in practice writes go through the service client, which
-- bypasses RLS; this policy is the belt-and-suspenders guard).
create policy feature_visibility_write on public.feature_visibility
  for all using (is_admin()) with check (is_admin());
