-- 0068_form_items.sql
--
-- Form Items, step 1: sort, don't skip (Form Items build spec, 16 October 2026).
--
-- What this makes possible:
--   * The application reader no longer silently leaves out the items on a
--     funder's form that need no writing. It sorts every item into one of:
--       written       a question to answer in prose (stays in draft_section,
--                     exactly as today);
--       fact          one value: short text, a number, a date, a choice from
--                     the funder's list, or yes/no (website, year established,
--                     project theme, reach, the yes/no disclosures);
--       confirmation  something the applicant ticks or certifies (terms and
--                     conditions, data privacy, a marketing release).
--     Facts and confirmations are kept here, in draft_form_item, which nothing
--     in drafting reads: the Storyboard, auto-draft, Undo, versions and the
--     finish line only ever see draft_section.
--   * Every item keeps its place in the funder's form (form_position), on both
--     tables, so the confirmation screen can say "31 items found: 13 to write,
--     15 form facts, 3 confirmations" and the whole form can later be put back
--     in the funder's order.
--
-- ADDITIVE. One new table and one new nullable column on draft_section (empty
-- for every existing question). No existing row changes. Who can read and
-- change form items follows the draft they belong to, like draft_context
-- (0063): today For Granted only, by grant_draft's own policies. Reversible by
-- dropping the table and the column.

alter table public.draft_section add column if not exists form_position integer;

create table if not exists public.draft_form_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  draft_id       uuid not null references public.grant_draft(id) on delete cascade,
  sort_order     integer not null,
  form_position  integer,
  kind           text not null check (kind in ('fact', 'confirmation')),
  answer_type    text check (answer_type in ('short_text', 'number', 'date', 'choice', 'yes_no')),
  options        text[] not null default '{}',
  prompt         text not null,
  guidance       text,
  in_source      boolean not null default true,
  origin         text not null default 'parsed' check (origin in ('parsed', 'manual')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (kind = 'fact' or answer_type is null)
);
create index if not exists draft_form_item_draft on public.draft_form_item (tenant_id, draft_id, sort_order);

alter table public.draft_form_item enable row level security;

drop policy if exists draft_form_item_follows_draft on public.draft_form_item;
create policy draft_form_item_follows_draft on public.draft_form_item for all
  using (exists (select 1 from public.grant_draft d where d.id = draft_form_item.draft_id and d.tenant_id = draft_form_item.tenant_id))
  with check (exists (select 1 from public.grant_draft d where d.id = draft_form_item.draft_id and d.tenant_id = draft_form_item.tenant_id));
