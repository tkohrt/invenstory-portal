-- 0042_arrange.sql
--
-- Story Card Drafter, Phase 3: the drafting workspace (Arrange).
-- Spec: "Story Card Drafter: Build Spec", sections 3.3, 7, 8, 10.1, 12 and 16.1.
--
-- What this makes possible: a For Granted writer builds each answer from Story
-- Cards, in order, and every card shown, added, removed, moved or edited is
-- logged from the first release (Decision 7: learning depends on history that
-- cannot be recovered later). Each client also gets one built-in application,
-- Standard Answers, whose approved sections become Answer Library answers that
-- still trace to the cards they were built from.
--
-- ADDITIVE. NO EXISTING ROW IS CHANGED.
--   * grant_draft gains `purpose` (default 'application', so every existing
--     draft reads exactly as before) and a partial unique index allowing one
--     Standard Answers draft per client.
--   * section_block gains `break_before` (default false): a paragraph break
--     before the block, so a pasted answer is not one paragraph.
--   * answer gains `draft_section_id` (nullable): which Standard Answers section
--     an approved answer was built from. The 20 existing answers keep null.
--   * One new table, card_event, append-only and admin-only.
--   * job_kind_check is NOT widened: nothing in Phase 3 runs as a job.
--
-- Numbering: the spec's 0041_card_learning became 0042 when 0040 went to
-- housekeeping. Only the event log is created here. voice_profile (Phase 6) and
-- pattern_stat (Phase 7) wait for the phases that use them, so no empty table
-- sits in production inviting a second, competing design.

-- ---------------------------------------------------------------------------
-- 1. Standard Answers: one built-in application per client.
-- ---------------------------------------------------------------------------
alter table public.grant_draft
  add column if not exists purpose text not null default 'application'
    check (purpose in ('application','standard_answers'));

create unique index if not exists grant_draft_standard_answers_uq
  on public.grant_draft (tenant_id) where purpose = 'standard_answers';

-- ---------------------------------------------------------------------------
-- 2. Blocks can start a new paragraph.
-- ---------------------------------------------------------------------------
alter table public.section_block
  add column if not exists break_before boolean not null default false;

-- ---------------------------------------------------------------------------
-- 3. An approved standard answer remembers where it was built.
-- ---------------------------------------------------------------------------
alter table public.answer
  add column if not exists draft_section_id uuid references public.draft_section(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. The event log. Append-only: there is no update or delete policy, and the
--    application only ever inserts.
-- ---------------------------------------------------------------------------
create table if not exists public.card_event (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  draft_id    uuid references public.grant_draft(id) on delete cascade,
  section_id  uuid references public.draft_section(id) on delete cascade,
  card_id     uuid references public.story_card(id) on delete cascade,
  block_id    uuid,
  event       text not null check (event in (
                'shown','added','removed','reordered','edited','proposed_to_library',
                'bridge_proposed','bridge_accepted','bridge_rejected','bridge_edited',
                'trim_accepted','trim_rejected')),
  position    integer,          -- rank when shown; needed to correct for position bias
  rank_score  numeric,
  actor       uuid references public.app_user(id),
  actor_role  text check (actor_role in ('admin','client')),
  payload     jsonb,            -- e.g. {before, after} for edits, {from, to} for moves
  created_at  timestamptz not null default now()
);
create index if not exists card_event_tenant_idx  on public.card_event (tenant_id, created_at);
create index if not exists card_event_section_idx on public.card_event (section_id);
create index if not exists card_event_card_idx    on public.card_event (card_id);

alter table public.card_event enable row level security;
create policy card_event_select on public.card_event for select using (is_admin());
create policy card_event_insert on public.card_event for insert with check (is_admin());
