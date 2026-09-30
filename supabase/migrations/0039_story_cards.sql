-- 0039_story_cards.sql
--
-- The Card Library: Phase 1 of the Story Card Drafter.
-- Spec: "Story Card Drafter: Build Spec" in the Inven(s)tory Portal project docs.
--
-- A Story Card is one claim-sized piece of a client's story, with the verbatim
-- quote that proves it. Cards belong to the client, not to any grant
-- application: they are extracted per document when a document changes, and the
-- drafter (Phase 3) only ever ranks them. That stable identity is what later
-- lets preferences, voice and outcomes accumulate on a card instead of
-- scattering across near-duplicates regenerated for every application.
--
-- ADDITIVE ONLY. Creates five new tables and widens one CHECK constraint on
-- public.job so a 'cards' job can be recorded. No existing row is read,
-- changed or deleted.
--
-- ADMIN-ONLY BY DESIGN. Decision 1 of the spec: For Granted writers hold the
-- pen in version 1 and the Card Library is never shown to client accounts.
-- Every policy below is is_admin(). A later phase that opens verification to
-- clients adds tenant policies then, deliberately.

-- ---------------------------------------------------------------------------
-- The cards themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.story_card (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant(id) on delete cascade,

  -- One of the card kinds in lib/story-card.ts. Checked in code rather than
  -- here, because the list is expected to grow and a CHECK would turn every
  -- addition into a migration.
  kind                 text not null,

  -- One to three sentences, in the organization's own vocabulary.
  statement            text not null,
  -- 'human' once a person has edited it. Extraction never overwrites a human
  -- statement: the same rule profile_edit applies to the Search Profile.
  statement_origin     text not null default 'machine'
                         check (statement_origin in ('machine','human')),

  -- The readiness checklist key (lib/checklist.ts) this card evidences, when one applies.
  item_key             text,
  -- The strongest layer among the card's evidence.
  layer                text check (layer in ('I','II','III')),
  -- Competitor facts never become cards. Third-party facts are allowed only
  -- for partnership, beneficiary_story and client_voice (enforced in code).
  subject              text not null default 'organization'
                         check (subject in ('organization','third_party')),
  strength             text not null default 'thin' check (strength in ('covered','thin')),
  -- Set from the QUOTE, never from the model's claim about the quote.
  has_figures          boolean not null default false,

  -- Set when an admin decides a flagged pair are distinct, so the same card
  -- is never flagged again.
  duplicate_dismissed  boolean not null default false,

  status               text not null default 'suggested'
                         check (status in ('suggested','verified','retired')),
  -- source_removed | superseded | merged | inaccurate
  retired_reason       text,
  merged_into          uuid references public.story_card(id) on delete set null,
  -- A likely duplicate found by the lexical check, for an admin to merge or
  -- dismiss. Never merged automatically: similarity may suggest, not decide.
  possible_duplicate_of uuid references public.story_card(id) on delete set null,

  -- The normalised claim, for exact de-duplication across documents.
  fingerprint          text not null,
  created_from         text not null default 'extraction'
                         check (created_from in ('extraction','gap','manual')),
  version              integer not null default 1,

  verified_by          uuid references public.app_user(id),
  verified_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (tenant_id, fingerprint)
);

comment on table public.story_card is
  'Story Cards: claim-sized, quote-backed pieces of a client''s story. The Card Library. Extracted per document; ranked (never generated) by the drafter.';

create index if not exists story_card_tenant_idx        on public.story_card (tenant_id);
create index if not exists story_card_tenant_status_idx on public.story_card (tenant_id, status, kind);

-- ---------------------------------------------------------------------------
-- Every statement a card has ever had, so a submitted application can always
-- say exactly which words it used (Phase 6).
-- ---------------------------------------------------------------------------
create table if not exists public.story_card_version (
  card_id     uuid not null references public.story_card(id) on delete cascade,
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  version     integer not null,
  statement   text not null,
  origin      text not null check (origin in ('machine','human')),
  created_by  uuid references public.app_user(id),
  created_at  timestamptz not null default now(),
  primary key (card_id, version)
);

create index if not exists story_card_version_tenant_idx on public.story_card_version (tenant_id);

-- ---------------------------------------------------------------------------
-- The proof. A card with no evidence left is retired by the build job.
-- ---------------------------------------------------------------------------
create table if not exists public.story_card_evidence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  card_id       uuid not null references public.story_card(id) on delete cascade,
  document_id   uuid not null references public.document(id) on delete cascade,
  -- Checked verbatim against the document's text in code before it is stored.
  quote         text not null,
  -- For transcripts: the speaker label the quote falls under, when known.
  speaker       text,
  extracted_at  timestamptz not null default now(),
  unique (card_id, document_id)
);

create index if not exists story_card_evidence_tenant_idx on public.story_card_evidence (tenant_id);
create index if not exists story_card_evidence_card_idx   on public.story_card_evidence (card_id);
create index if not exists story_card_evidence_doc_idx    on public.story_card_evidence (document_id);

-- ---------------------------------------------------------------------------
-- Per-document cache, mirroring search_profile_doc: adding one document costs
-- one document of model time, and a change to the merge rules is a free
-- re-merge from stored candidates rather than a paid re-read.
-- ---------------------------------------------------------------------------
create table if not exists public.story_card_doc (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  document_id   uuid not null references public.document(id) on delete cascade,
  -- Same convention as search_profile_doc: '<length>:<hash>' of the text read,
  -- or 'boilerplate' / 'empty' for a deliberate skip.
  content_hash  text not null,
  candidates    jsonb not null default '[]'::jsonb,
  -- Candidates the code refused (quote not found, figures not in quote,
  -- competitor subject...), kept so the audit can show what was dropped and why.
  rejected      jsonb not null default '[]'::jsonb,
  windows       integer not null default 0,
  extracted_at  timestamptz not null default now(),
  primary key (tenant_id, document_id)
);

create index if not exists story_card_doc_tenant_idx on public.story_card_doc (tenant_id);

-- ---------------------------------------------------------------------------
-- Other renderings of a card (short, story-length, tailored to one draft).
-- Created in later phases; here now so 0040 can reference it.
-- ---------------------------------------------------------------------------
create table if not exists public.story_card_variant (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  card_id     uuid not null references public.story_card(id) on delete cascade,
  draft_id    uuid references public.grant_draft(id) on delete cascade,
  length      text not null check (length in ('short','standard','story','tailored')),
  text        text not null,
  origin      text not null check (origin in ('ai','human')),
  created_by  uuid references public.app_user(id),
  created_at  timestamptz not null default now()
);

create index if not exists story_card_variant_tenant_idx on public.story_card_variant (tenant_id);
create index if not exists story_card_variant_card_idx   on public.story_card_variant (card_id);

-- ---------------------------------------------------------------------------
-- Row-level security: admin only (Decision 1).
-- ---------------------------------------------------------------------------
alter table public.story_card          enable row level security;
alter table public.story_card_version  enable row level security;
alter table public.story_card_evidence enable row level security;
alter table public.story_card_doc      enable row level security;
alter table public.story_card_variant  enable row level security;

create policy story_card_admin          on public.story_card          for all using (is_admin()) with check (is_admin());
create policy story_card_version_admin  on public.story_card_version  for all using (is_admin()) with check (is_admin());
create policy story_card_evidence_admin on public.story_card_evidence for all using (is_admin()) with check (is_admin());
create policy story_card_doc_admin      on public.story_card_doc      for all using (is_admin()) with check (is_admin());
create policy story_card_variant_admin  on public.story_card_variant  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Let the job table record a Card Library build. 'parse_application' is
-- Phase 2's, added now so that phase does not need to touch this constraint.
-- ---------------------------------------------------------------------------
alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales','cards','parse_application'));
