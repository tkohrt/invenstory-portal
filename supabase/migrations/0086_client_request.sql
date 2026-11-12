-- 0086: the Requests inbox (patch 37, 12 Nov 2026).
--
-- Until now, client-triggered notifications went to Slack and email and
-- nowhere else: two delivery channels, no system of record. Scalable and
-- auditable means a row first: every notify-worthy event lands here, with a
-- status ladder and a handled-by trail, and Slack/email become pagers
-- pointing at the inbox (the third Review queues tab) instead of the record.

create table if not exists public.client_request (
  id          uuid primary key default gen_random_uuid(),
  -- Null for events with no tenant, e.g. a website lead from forgranted.com.
  tenant_id   uuid references public.tenant(id) on delete cascade,
  kind        text not null,
  detail      text not null,
  -- For auto-resolution: e.g. 'flag:<factId>', so unflagging closes the row.
  source_key  text,
  created_by  uuid references public.app_user(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- open: needs a For Granted decision. seen: informational, logged without
  -- becoming a chore. done/dismissed: handled, with the trail below.
  status      text not null default 'open' check (status in ('open','seen','done','dismissed')),
  handled_by  uuid references public.app_user(id) on delete set null,
  handled_at  timestamptz,
  resolution  text
);

comment on table public.client_request is
  'System of record for client-triggered events (patch 37). Written by notify.ts before any Slack/email goes out; the admin Requests inbox reads and resolves it. The audit trail for who asked, who handled, when, and what was done.';

create index if not exists client_request_status_idx on public.client_request (status, created_at desc);
create index if not exists client_request_tenant_idx on public.client_request (tenant_id, created_at desc);
create index if not exists client_request_source_idx on public.client_request (source_key) where source_key is not null;

alter table public.client_request enable row level security;
-- Admin-only reads for now; a client-side mirror later would add a
-- tenant-scoped select. Writes happen through the service role.
create policy client_request_select on public.client_request for select using (is_admin());
create policy client_request_write on public.client_request for all using (is_admin()) with check (is_admin());
