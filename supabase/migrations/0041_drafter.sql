-- 0041_drafter.sql
--
-- Story Card Drafter, Phase 2: bringing in a funder's application.
-- Spec: "Story Card Drafter: Build Spec", sections 3.2, 6 and 16.6.
--
-- What this makes possible: a For Granted writer brings a funder's application
-- into the portal (pasted, uploaded, fetched from a URL, or started from a
-- Funder Matches row), the portal splits it into its questions, a person
-- confirms that split, and every confirmed question is logged as a question
-- observation matched against the question bank, so the bank can grow from
-- what funders actually ask.
--
-- ADDITIVE, WITH ONE POLICY CHANGE.
--   * Adds nullable columns (and two with defaults) to grant_draft. Every
--     existing draft becomes mode = 'bracket' and behaves exactly as before.
--   * Adds four columns to grant_question, with defaults. The 19 seeded
--     questions are unchanged.
--   * Creates six new tables. No existing row is read, changed or deleted.
--   * REPLACES grant_draft_select so client accounts only see bracket-mode
--     drafts. A card-mode draft holds the funder's full application text and
--     For Granted's working structure, and Decision 1 of the spec keeps the
--     drafter away from client accounts in version 1. Admins see everything,
--     as before. This is the only statement here that alters existing
--     behaviour, and it is reversible by recreating the old policy.
--
-- Numbering: 0040 went to housekeeping, so the spec's 0040_drafter is this file,
-- and its 0041_card_learning becomes 0042.

-- ---------------------------------------------------------------------------
-- 1. grant_draft: a draft can now be built from a funder's application.
-- ---------------------------------------------------------------------------
alter table public.grant_draft
  add column if not exists mode            text not null default 'bracket'
                                             check (mode in ('bracket','cards')),
  add column if not exists source_kind     text check (source_kind in ('url','pdf','docx','paste','match')),
  add column if not exists source_url      text,
  -- The funder's application text as ingested. Deliberately NOT filed into the
  -- Inven(s)tory: it is the funder's words, not the client's story.
  add column if not exists source_text     text,
  add column if not exists source_filename text,
  -- {grant_id} or {funder_ein} when started from Funder Matches.
  add column if not exists opportunity_ref jsonb,
  -- Attachments the application asks for (budget, 990, letters...), as parsed.
  add column if not exists required_attachments jsonb not null default '[]'::jsonb,
  -- Scratch for the chained parse job: per-window results survive between
  -- invocations. Cleared when the parse finishes.
  add column if not exists parse_state     jsonb,
  add column if not exists parsed_at       timestamptz,
  -- Set when a person confirms the parsed questions. Drafting waits for this.
  add column if not exists confirmed_at    timestamptz,
  add column if not exists confirmed_by    uuid references public.app_user(id),
  add column if not exists submitted_at    timestamptz,
  add column if not exists outcome_detail  jsonb,   -- {score, reviewer_feedback, amount_awarded}
  add column if not exists ai_disclosure   text;

drop policy if exists grant_draft_select on public.grant_draft;
create policy grant_draft_select on public.grant_draft for select
  using ((tenant_id = current_tenant_id() and mode = 'bracket') or is_admin());

-- ---------------------------------------------------------------------------
-- 2. The application's questions.
-- ---------------------------------------------------------------------------
create table if not exists public.draft_section (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  draft_id        uuid not null references public.grant_draft(id) on delete cascade,
  sort_order      integer not null,
  prompt          text not null,                  -- the funder's question, verbatim
  guidance        text,                           -- sub-prompts and instructions
  limit_value     integer,
  limit_unit      text check (limit_unit in ('words','characters')),
  criteria        text,                           -- scoring criteria, if published
  question_slugs  text[] not null default '{}',   -- grant_question slugs it maps to
  wanted_kinds    text[] not null default '{}',   -- card kinds this question calls for
  -- Beyond the spec, for Phase 2:
  origin          text not null default 'parsed' check (origin in ('parsed','manual')),
  -- False when the parsed prompt could not be found in the source text. Shown
  -- as a flag on the confirmation screen, never silently dropped.
  in_source       boolean not null default true,
  -- The bank match: the reason, and the prompt it was made on, so an edited
  -- prompt is re-matched at confirmation instead of keeping a stale match.
  match_reason    text,
  matched_prompt  text,
  confirmed       boolean not null default false,
  status          text not null default 'empty' check (status in ('empty','drafting','done')),
  updated_at      timestamptz not null default now()
);
create index if not exists draft_section_tenant_idx on public.draft_section (tenant_id);
create index if not exists draft_section_draft_idx  on public.draft_section (draft_id, sort_order);

-- ---------------------------------------------------------------------------
-- 3. Answers as ordered blocks (Phase 3 fills these; created now per the spec).
-- ---------------------------------------------------------------------------
create table if not exists public.section_block (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  section_id    uuid not null references public.draft_section(id) on delete cascade,
  sort_order    integer not null,
  kind          text not null check (kind in ('card','bridge','human')),
  card_id       uuid references public.story_card(id),
  card_version  integer,
  variant_id    uuid references public.story_card_variant(id) on delete set null,
  text          text,
  edited        boolean not null default false,
  proposed      boolean not null default false,
  created_by    uuid references public.app_user(id),
  updated_at    timestamptz not null default now(),
  check (kind <> 'card' or card_id is not null)
);
create index if not exists section_block_tenant_idx  on public.section_block (tenant_id);
create index if not exists section_block_section_idx on public.section_block (section_id, sort_order);

-- ---------------------------------------------------------------------------
-- 4. Frozen submissions (Phase 6 writes these). Insert and select only.
-- ---------------------------------------------------------------------------
create table if not exists public.draft_snapshot (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  draft_id  uuid not null references public.grant_draft(id) on delete cascade,
  reason    text not null check (reason in ('submitted','manual')),
  content   jsonb not null,
  taken_by  uuid references public.app_user(id),
  taken_at  timestamptz not null default now()
);
create index if not exists draft_snapshot_tenant_idx on public.draft_snapshot (tenant_id);
create index if not exists draft_snapshot_draft_idx  on public.draft_snapshot (draft_id);

-- ---------------------------------------------------------------------------
-- 5. Question bank growth (spec 16.6).
-- ---------------------------------------------------------------------------

-- Possible new bank questions. For Granted IP: no tenant_id, admin-only,
-- deliberately absent from TENANT_SCOPED (like ledger_overlay). Created before
-- question_observation so the foreign key can be declared.
create table if not exists public.question_candidate (
  id                 uuid primary key default gen_random_uuid(),
  proposed_prompt    text not null,
  category           text,
  audience           text check (audience in ('nonprofit','startup','both')),
  status             text not null default 'open'
                       check (status in ('open','approved','merged','dismissed')),
  merged_into        uuid references public.grant_question(id) on delete set null,
  approved_question  uuid references public.grant_question(id) on delete set null,
  n_observations     integer not null default 0,
  n_funders          integer not null default 0,
  n_tenants          integer not null default 0,
  created_at         timestamptz not null default now(),
  decided_by         uuid references public.app_user(id),
  decided_at         timestamptz
);

-- One row per question seen anywhere. Tenant-scoped because it records which
-- client's draft or document it came from; admin-only.
create table if not exists public.question_observation (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  source           text not null check (source in ('draft','past_application','funder_form')),
  draft_id         uuid references public.grant_draft(id) on delete set null,
  draft_section_id uuid references public.draft_section(id) on delete set null,
  document_id      uuid references public.document(id) on delete set null,
  funder           text,
  prompt           text not null,               -- verbatim
  guidance         text,
  limit_value      integer,
  limit_unit       text check (limit_unit in ('words','characters')),
  matched_question uuid references public.grant_question(id) on delete set null,
  match_reason     text,
  -- 'model' or 'admin': who decided the match. An admin override outranks the model.
  matched_by       text check (matched_by in ('model','admin')),
  candidate_id     uuid references public.question_candidate(id) on delete set null,
  observed_at      timestamptz not null default now()
);
create index if not exists question_observation_tenant_idx    on public.question_observation (tenant_id);
create index if not exists question_observation_matched_idx   on public.question_observation (matched_question);
create index if not exists question_observation_unmatched_idx on public.question_observation (observed_at)
  where matched_question is null;
-- A draft section is observed once. Re-confirming replaces its row.
create unique index if not exists question_observation_section_uq
  on public.question_observation (draft_section_id) where draft_section_id is not null;

alter table public.grant_question
  add column if not exists origin        text not null default 'seed' check (origin in ('seed','observed')),
  add column if not exists wanted_kinds  text[] not null default '{}',
  add column if not exists typical_limit integer,
  add column if not exists observed      integer not null default 0;

-- Keep grant_question.observed exact without a read-then-write in the app.
create or replace function public.question_observed_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.matched_question is not null then
    update grant_question set observed = greatest(observed - 1, 0) where id = old.matched_question;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.matched_question is not null then
    update grant_question set observed = observed + 1 where id = new.matched_question;
  end if;
  return null;
end $$;
revoke execute on function public.question_observed_count() from public, anon, authenticated;

drop trigger if exists question_observation_count on public.question_observation;
create trigger question_observation_count
  after insert or delete or update of matched_question on public.question_observation
  for each row execute function public.question_observed_count();

-- ---------------------------------------------------------------------------
-- 6. Row-level security: admin only (Decision 1). Snapshots cannot be changed.
-- ---------------------------------------------------------------------------
alter table public.draft_section        enable row level security;
alter table public.section_block        enable row level security;
alter table public.draft_snapshot       enable row level security;
alter table public.question_observation enable row level security;
alter table public.question_candidate   enable row level security;

create policy draft_section_admin        on public.draft_section        for all using (is_admin()) with check (is_admin());
create policy section_block_admin        on public.section_block        for all using (is_admin()) with check (is_admin());
create policy question_observation_admin on public.question_observation for all using (is_admin()) with check (is_admin());
create policy question_candidate_admin   on public.question_candidate   for all using (is_admin()) with check (is_admin());

create policy draft_snapshot_select on public.draft_snapshot for select using (is_admin());
create policy draft_snapshot_insert on public.draft_snapshot for insert with check (is_admin());
