-- 0063_draft_context.sql
--
-- Auto-Draft, patch 5: the grant context box (Auto-Draft build spec, sections
-- 4a and 10; 12 October 2026).
--
-- What this makes possible:
--   * Each draft can carry context in two parts:
--       funder  the funder's overview, FAQ, website, About page, mission, priorities;
--       client  anything the client has said that should shape this application
--               (which program to lead with, a partner to mention, what to avoid).
--   * Any number of items per part, each typed or pasted text, a PDF, a Word
--     file, a .txt file or a web address, read into text the same way the
--     funder's application is. The original file is kept beside it.
--   * Auto-draft reads it (a later patch). It is never filed into the client's
--     Inven(s)tory, like the funder's application text today.
--
-- ADDITIVE. One new table. No existing row changes. Who can read and add
-- context follows the draft it belongs to: whoever can open the draft (today,
-- For Granted only, by grant_draft's own policies; a client too, the day
-- self-serve drafting gives clients their drafts). Reversible by dropping the
-- table.

create table if not exists public.draft_context (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  draft_id     uuid not null references public.grant_draft(id) on delete cascade,
  part         text not null check (part in ('funder', 'client')),
  title        text not null,
  body         text not null default '',
  source_kind  text not null check (source_kind in ('text', 'pdf', 'docx', 'txt', 'url')),
  source_url   text,
  storage_key  text,
  file_type    text,
  added_by     uuid references public.app_user(id) on delete set null,
  added_at     timestamptz not null default now()
);
create index if not exists draft_context_draft on public.draft_context (tenant_id, draft_id, part, added_at);

alter table public.draft_context enable row level security;

drop policy if exists draft_context_follows_draft on public.draft_context;
create policy draft_context_follows_draft on public.draft_context for all
  using (exists (select 1 from public.grant_draft d where d.id = draft_context.draft_id and d.tenant_id = draft_context.tenant_id))
  with check (exists (select 1 from public.grant_draft d where d.id = draft_context.draft_id and d.tenant_id = draft_context.tenant_id));
