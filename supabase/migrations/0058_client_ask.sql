-- 0058: For Granted asks the client (9 October 2026).
--
-- From the gap panel under a question in the Storyboard, For Granted can ask a
-- client for something the question needs and no Story Card holds yet. The
-- client sees the question on their Inven(s)tory page and answers it in their
-- own words; the answer is saved as a user-generated Story Card written by the
-- client (0057), and the Storyboard offers it to the question that asked.
--
-- Additive only: one new table. No existing row changes.

create table if not exists public.client_ask (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  -- The draft and question it was asked for.
  draft_id     uuid references public.grant_draft(id) on delete set null,
  section_id   uuid references public.draft_section(id) on delete set null,
  -- The kind of Story Card the question needs (story_card.kind).
  kind         text not null,
  question     text not null,
  status       text not null default 'open' check (status in ('open','answered','withdrawn')),
  asked_by     uuid references public.app_user(id) on delete set null,
  asked_at     timestamptz not null default now(),
  answer       text,
  answered_by  uuid references public.app_user(id) on delete set null,
  answered_at  timestamptz,
  -- The user-generated Story Card the answer became.
  card_id      uuid references public.story_card(id) on delete set null
);
create index if not exists client_ask_tenant_status on public.client_ask (tenant_id, status, asked_at desc);
create index if not exists client_ask_draft on public.client_ask (draft_id);

alter table public.client_ask enable row level security;

-- A client reads its own questions; only For Granted writes through RLS. A
-- client's answer is saved by the portal's server, scoped to the client's session.
create policy client_ask_select on public.client_ask for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy client_ask_write on public.client_ask for all using (is_admin()) with check (is_admin());
