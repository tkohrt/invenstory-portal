-- 0081: the Watchlist and Saved for later (patch 26, 11 Nov 2026).
--
-- Two decisions from the 7 Nov walkthrough, both Shane's asks:
--  1. A closed-but-aligned call is a lead for next cycle, not a dropped row.
--     The screener now keeps it under a fourth verdict, 'watch'.
--  2. "I'm interested - save for later": a star on a grant row puts it in a
--     bucket that survives sweeps, so it can resurface when the call reopens.

-- The verdict ladder grows a rung. 0017 created the constraint inline, so it
-- carries the default name. If this drop silently matches nothing, the insert
-- of the first 'watch' row will fail loudly, which is the right alarm.
alter table public.eligible_grant
  drop constraint if exists eligible_grant_verdict_check;
alter table public.eligible_grant
  add constraint eligible_grant_verdict_check
  check (verdict in ('eligible','likely','check','watch'));

comment on column public.eligible_grant.verdict is
  'eligible | likely | check | watch. watch (0081): the last cycle has closed but the fit is real; shown under "Not open now, worth watching", never among open calls.';

-- What a person chose to keep. Unlike eligible_grant this is NOT a run
-- snapshot: sweeps never touch it, which is the whole point. detail carries a
-- display snapshot (funder, url, close_date, award_ceiling) so a saved grant
-- still renders after the run that produced it is long gone.
create table if not exists public.saved_item (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  kind       text not null check (kind in ('grant','funder')),
  target_id  text not null,
  title      text,
  detail     jsonb not null default '{}'::jsonb,
  saved_by   uuid references public.app_user(id) on delete set null,
  saved_at   timestamptz not null default now(),
  primary key (tenant_id, kind, target_id)
);

comment on table public.saved_item is
  'Save-for-later bucket (patch 26). Survives match-run sweeps by design: a saved grant is the client''s bookmark, not a snapshot row.';
comment on column public.saved_item.detail is
  'Display snapshot at save time: {funder, url, close_date, award_ceiling}. Never authoritative; the live row wins when both exist.';

create index if not exists saved_item_tenant_idx
  on public.saved_item (tenant_id, saved_at desc);

alter table public.saved_item enable row level security;
create policy saved_item_select on public.saved_item for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy saved_item_write on public.saved_item for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
