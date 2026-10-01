-- 0043_card_care.sql
--
-- Story Card Drafter, Phase 3.1: what the walkthrough with Tyler asked for.
--
-- What this makes possible:
--   * A card that ties an identifiable person to health, recovery, justice or
--     similar protected status is flagged, and cannot be placed in an answer
--     until For Granted records consent, de-identifies it, or rules it not
--     sensitive. (42 CFR Part 2 and HIPAA matter for recovery clients.)
--   * Retiring a card can carry a note saying why.
--   * Clients can read their own cards, and verify, edit or mark them out of
--     date from a Story Cards page that ships hidden (feature 'card_review').
--   * Standard Answers knows when it was last opened, so it can say which bank
--     questions are new since then.
--   * A Card Library build keeps going after the page is closed, carried by the
--     server, with a ceiling on how many stages one build may chain.
--
-- ADDITIVE, WITH THREE NEW READ POLICIES.
--   * New nullable or defaulted columns on story_card, draft_section,
--     grant_draft and job. No existing value changes; every existing card reads
--     as not sensitive until the next re-merge or build assesses it.
--   * Adds SELECT policies so a signed-in client can read ITS OWN story cards,
--     their versions and their evidence. Today those are admin-only. Writes
--     stay admin-only at the database: a client's verify, edit and out-of-date
--     go through server actions that check the session and the feature.
--     story_card_doc (the model's raw candidates and refusals) stays admin-only.
--     Reversible by dropping the three policies.

-- ---------------------------------------------------------------------------
-- 1. Sensitive stories, and why a card was retired.
-- ---------------------------------------------------------------------------
alter table public.story_card
  add column if not exists sensitive            boolean not null default false,
  -- Plain words, for the person reviewing: what was found, and by whom.
  add column if not exists sensitive_reason     text,
  -- How the flag was cleared. Placement is allowed when this is set.
  add column if not exists sensitive_cleared    text check (sensitive_cleared in ('consent','deidentified','not_sensitive')),
  add column if not exists sensitive_note       text,
  add column if not exists sensitive_cleared_by uuid references public.app_user(id),
  add column if not exists sensitive_cleared_at timestamptz,
  add column if not exists retired_note         text,
  -- Who verified: For Granted, or the client from their Story Cards page.
  add column if not exists verified_by_role     text check (verified_by_role in ('admin','client'));

-- ---------------------------------------------------------------------------
-- 2. Standard Answers: what is new since it was last opened.
-- ---------------------------------------------------------------------------
alter table public.draft_section
  add column if not exists created_at timestamptz not null default now();
alter table public.grant_draft
  add column if not exists seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Builds that carry on without the page: how many stages this build has run.
-- ---------------------------------------------------------------------------
alter table public.job
  add column if not exists chain_passes integer not null default 0;

-- ---------------------------------------------------------------------------
-- 4. Clients may read their own cards.
-- ---------------------------------------------------------------------------
create policy story_card_select_own on public.story_card
  for select using (tenant_id = current_tenant_id());
create policy story_card_version_select_own on public.story_card_version
  for select using (tenant_id = current_tenant_id());
create policy story_card_evidence_select_own on public.story_card_evidence
  for select using (tenant_id = current_tenant_id());
