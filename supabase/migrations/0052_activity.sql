-- 0052_activity.sql
--
-- Client activity, patch 2 (planned 6 October 2026).
--
-- What this makes possible:
--   * The funder's application file a draft was made from (a PDF or Word file,
--     uploaded or fetched from a link) is kept, so For Granted can open the
--     original from the client activity page. Until now only its text was kept.
--   * The portal records when client logins use it: one row per person per
--     part of the portal, at most once every 30 minutes, with the page's path
--     (ids removed) and nothing else. No keystrokes, no content, no query
--     strings. A row that starts after 30 quiet minutes marks a new visit.
--     For Granted's own use is not recorded.
--
-- ADDITIVE. Two columns on grant_draft (empty for existing drafts) and one new
-- table, admin-only under RLS and written only by the server.

alter table public.grant_draft add column if not exists source_storage_key text;
alter table public.grant_draft add column if not exists source_mime text;

create table if not exists public.activity_event (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  user_id        uuid not null references public.app_user(id) on delete cascade,
  feature        text not null,        -- invenstory, chat, eligibility, funder_matches, story_cards, analysis, drafts, ...
  path           text not null,        -- e.g. /drafts/:id (ids removed, no query string)
  session_start  boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists activity_event_tenant_at on public.activity_event (tenant_id, created_at desc);
create index if not exists activity_event_user_at on public.activity_event (user_id, created_at desc);

alter table public.activity_event enable row level security;
create policy activity_event_admin on public.activity_event for all using (is_admin()) with check (is_admin());
