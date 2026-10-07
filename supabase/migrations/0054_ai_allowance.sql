-- 0054_ai_allowance.sql
--
-- Inven(s)tory Analysis, Phase D, patch 2: the monthly AI allowance
-- (Build Decisions 24, 30 and 32).
--
-- What this makes possible:
--   * Each client has a monthly AI allowance: $20 of client-caused AI spend,
--     as measured by the meter (ai_usage, 0051), unless For Granted sets a
--     different amount here. It is a soft line: past it nothing stops and For
--     Granted is alerted. The one hard stop is a ceiling, 2x the allowance
--     unless For Granted sets another (ceiling_cents). A client with no row
--     has the defaults.
--   * For Granted can grant extra for one month (usage_grant kind 'ai_month',
--     extra in cents), and a client at the allowance can ask for more
--     (usage_request kind 'ai_month').
--   * One sum of a client's own spend this month, in the database, rather than
--     every metered call sent to the portal to be added up.
--
-- ADDITIVE. One new table (readable by the client's own tenant and by admins,
-- written only by admins), one read-only function, and the kind checks on
-- usage_grant and usage_request widened by one value each. No existing row
-- changes. Reversible by dropping the table and function and narrowing the
-- checks back.

create table if not exists public.ai_allowance (
  tenant_id      uuid primary key references public.tenant(id) on delete cascade,
  monthly_cents  int not null check (monthly_cents >= 0 and monthly_cents <= 1000000),
  ceiling_cents  int check (ceiling_cents >= 0 and ceiling_cents <= 1000000),  -- null: 2x the allowance
  note           text,
  updated_by     uuid references public.app_user(id),
  updated_at     timestamptz not null default now()
);
alter table public.ai_allowance enable row level security;
create policy ai_allowance_select on public.ai_allowance for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy ai_allowance_write on public.ai_allowance for all using (is_admin()) with check (is_admin());

alter table public.usage_grant drop constraint if exists usage_grant_kind_check;
alter table public.usage_grant add constraint usage_grant_kind_check check (kind in ('chat_month','ai_month'));
alter table public.usage_request drop constraint if exists usage_request_kind_check;
alter table public.usage_request add constraint usage_request_kind_check check (kind in ('chat_month','ai_month'));

-- SECURITY INVOKER, like tenant_word_count (0011): under RLS a client sums only
-- their own tenant's rows; the portal calls it with the service role.
create or replace function public.client_ai_spend_micros(p_tenant uuid, p_since timestamptz)
returns bigint language sql stable security invoker set search_path = public as $$
  select coalesce(sum(cost_micros), 0)::bigint
  from public.ai_usage
  where tenant_id = p_tenant and actor = 'client' and created_at >= p_since;
$$;
