-- 0057: user-generated Story Cards (8 October 2026).
--
-- A writer can type a fact or story straight into a draft and save it as a
-- Story Card. The words are filed as a short "Writer's note" document in the
-- client's Inven(s)tory and the card quotes it, so every card still traces to a
-- source: here, the person who wrote it, on that date. These cards are marked
-- created_from = 'manual' (shown as "User-generated").
--
-- Additive only: new nullable columns on story_card. No existing row changes.

alter table public.story_card
  -- Who wrote the card, and whether they were For Granted or the client.
  add column if not exists written_by        uuid references public.app_user(id) on delete set null,
  add column if not exists written_by_role   text check (written_by_role in ('admin','client')),
  -- "Written by Shane Winnyk, For Granted, 8 October 2026", or the document it came from.
  add column if not exists source_line       text,
  -- Whose words these are, when they are a person's: "Ashley Barrow, CEO".
  add column if not exists said_by           text,
  -- The date the fact is true as of.
  add column if not exists as_of             date,
  -- The draft and question it was written in.
  add column if not exists origin_draft_id   uuid references public.grant_draft(id) on delete set null,
  add column if not exists origin_section_id uuid references public.draft_section(id) on delete set null,
  -- A card For Granted wrote about a client, once the client has confirmed it.
  add column if not exists client_confirmed_at timestamptz,
  add column if not exists client_confirmed_by uuid references public.app_user(id) on delete set null;

create index if not exists story_card_manual_idx on public.story_card (tenant_id) where created_from = 'manual';
