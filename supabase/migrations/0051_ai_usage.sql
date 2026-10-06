-- 0051_ai_usage.sql
--
-- AI usage: the meter, and the client limits (decided 6 October 2026).
--
-- What this makes possible:
--   * Every model call records the tokens it actually used and what that cost,
--     with the client it was for, the feature, and who caused it (a client
--     login, For Granted, or a background step). Today those numbers are
--     thrown away; this is the base for Phase D's monthly allowance per client.
--   * When a client reaches a limit (50 chat questions a day per person, 500 a
--     month per client), they can ask For Granted for more. The request waits
--     here, and For Granted's answer is recorded as a grant for that month.
--
-- Admins are never limited. Clients can read their own rows; only admins
-- write through RLS (the server writes through the service client).
--
-- ADDITIVE. Three new tables; no existing row or column changes.

create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  tenant_id      uuid references public.tenant(id) on delete cascade,  -- null when no client was in context
  user_id        uuid references public.app_user(id) on delete set null,
  actor          text not null check (actor in ('client','admin','system')),
  feature        text not null,          -- chat, upload_readiness, story_intelligence, analysis, card_library, ...
  model          text not null,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  cost_micros    bigint not null default 0,   -- millionths of a dollar
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_tenant_at on public.ai_usage (tenant_id, created_at desc);

create table if not exists public.usage_grant (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  kind        text not null check (kind in ('chat_month')),
  period      text not null,              -- 'YYYY-MM', the month in Eastern time
  extra       int not null check (extra > 0),
  note        text,
  granted_by  uuid references public.app_user(id),
  granted_at  timestamptz not null default now()
);
create index if not exists usage_grant_tenant_period on public.usage_grant (tenant_id, kind, period);

create table if not exists public.usage_request (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  user_id      uuid references public.app_user(id),
  kind         text not null check (kind in ('chat_month')),
  status       text not null default 'pending' check (status in ('pending','granted','dismissed')),
  decided_by   uuid references public.app_user(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists usage_request_tenant on public.usage_request (tenant_id, created_at desc);

alter table public.ai_usage      enable row level security;
alter table public.usage_grant   enable row level security;
alter table public.usage_request enable row level security;

create policy ai_usage_select on public.ai_usage for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy ai_usage_write on public.ai_usage for all using (is_admin()) with check (is_admin());

create policy usage_grant_select on public.usage_grant for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy usage_grant_write on public.usage_grant for all using (is_admin()) with check (is_admin());

create policy usage_request_select on public.usage_request for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy usage_request_write on public.usage_request for all using (is_admin()) with check (is_admin());
