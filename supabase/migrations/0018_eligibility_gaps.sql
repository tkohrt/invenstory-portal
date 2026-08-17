-- Cached content-gap analysis (the Bedrock pass over a tenant's inventory).
-- Structural gaps are computed live from the profile; only the content analysis
-- is cached here.
create table if not exists public.eligibility_gap (
  tenant_id    uuid primary key references public.tenant(id) on delete cascade,
  content_gaps jsonb not null default '[]',
  computed_at  timestamptz
);
alter table public.eligibility_gap enable row level security;
create policy eligibility_gap_select on public.eligibility_gap for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy eligibility_gap_write on public.eligibility_gap for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
