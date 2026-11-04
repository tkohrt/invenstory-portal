-- The Portal Guide (patch 16, onboarding build, 3 November 2026).
-- Additive: one new table. No existing row changes.
--
-- Questions to the second chat tab, kept apart from chat_message on purpose:
-- they never count toward the client's chat limits, and their AI cost is
-- recorded as For Granted's own (ai_usage actor 'system', feature
-- 'portal_guide'), so it never counts against the client's AI allowance.
-- The guide never reads documents, so nothing here quotes one.
--
--   session_id   groups one Portal Guide conversation (no separate session table)
--   buttons      the tour or page buttons shown under the answer

create table if not exists public.guide_question (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  user_id     uuid not null references public.app_user(id) on delete cascade,
  session_id  uuid not null,
  question    text not null check (length(question) between 1 and 2000),
  answer      text not null default '',
  buttons     jsonb not null default '[]'::jsonb check (jsonb_typeof(buttons) = 'array'),
  generated   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists guide_question_user_idx on public.guide_question (tenant_id, user_id, created_at desc);
create index if not exists guide_question_session_idx on public.guide_question (session_id, created_at);

alter table public.guide_question enable row level security;

-- A person reads their own; For Granted reads every client's. Writes go
-- through the server (service role).
drop policy if exists guide_question_read on public.guide_question;
create policy guide_question_read on public.guide_question for select
  using ((tenant_id = current_tenant_id() and user_id = (select id from public.app_user where auth_id = auth.uid())) or is_admin());
drop policy if exists guide_question_admin on public.guide_question;
create policy guide_question_admin on public.guide_question for all
  using (is_admin()) with check (is_admin());
