-- 0048_analysis.sql
--
-- Inven(s)tory Analysis, Phase A: the one read.
--
-- What this makes possible:
--   * One model read of each document that returns three things at once: what
--     kind of document it is, the Story Cards in it, and the facts in it (EIN,
--     budget, state, populations served and the rest), each with its verbatim
--     quote. Stored per document, so a new or changed document costs one
--     document of work.
--   * A trial run beside the current reads. Nothing here feeds readiness, the
--     Card Library, Funding Eligibility or Funder Matches yet; that is Phase B,
--     behind a side-by-side comparison. What every client sees is unchanged.
--   * The card-quality review the Build Spec requires, sized as decided on
--     2 October 2026 (every card up to 100, else 100 drawn from each document
--     in proportion, plus every flagged duplicate pair), recorded one judgement
--     at a time so the gate is counted, not remembered.
--
-- ADDITIVE. Three new tables and one widened constraint. No existing row or
-- column changes. Both tables are admin-only under RLS, like story_card_doc.
-- Reversible by dropping the three tables and restoring the old job_kind_check.

-- ---------------------------------------------------------------------------
-- 1. What the one read found in each document.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_doc (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  document_id      uuid not null references public.document(id) on delete cascade,
  -- Text fingerprint in story_card_doc's format, or 'boilerplate' / 'empty'.
  content_hash     text not null,
  -- One of the keys in lib/analysis.ts DOC_TYPES (checked in code; the list will grow).
  doc_type         text,
  doc_type_reason  text,
  doc_type_quote   text,
  -- True when the quote offered for the type was found in the document.
  doc_type_proven  boolean not null default false,
  cards            jsonb not null default '[]',   -- accepted card candidates, same shape as story_card_doc.candidates
  facts            jsonb not null default '[]',   -- accepted facts: [{key, value, quote, layer, speaker}]
  rejected         jsonb not null default '[]',   -- everything the code refused, with the reason
  windows          int  not null default 0,
  chars            int  not null default 0,
  extracted_at     timestamptz not null default now(),
  primary key (tenant_id, document_id)
);
create index if not exists analysis_doc_tenant_idx on public.analysis_doc(tenant_id);

-- ---------------------------------------------------------------------------
-- 2. The card-quality review: one row per card a person has judged.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_review (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  -- The card's identity in the trial: cardFingerprint(kind, statement).
  fingerprint  text not null,
  document_id  uuid references public.document(id) on delete set null,
  kind         text not null,
  statement    text not null,
  quote        text not null,
  -- Does the quote fully support the statement?
  verdict      text not null check (verdict in ('supported','partly','unsupported')),
  competitor   boolean not null default false,  -- the card is really about a competitor
  duplicate    boolean not null default false,  -- says the same as another card in the sample
  note         text,
  reviewed_by  uuid references public.app_user(id),
  reviewed_at  timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);
create index if not exists analysis_review_tenant_idx on public.analysis_review(tenant_id);

-- ---------------------------------------------------------------------------
-- 3. Flagged possible duplicates: is each pair the same claim or not?
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_dup_review (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  card_fp      text not null,   -- the newer card of the pair
  other_fp     text not null,   -- the earlier card it looks like
  same         boolean not null,
  reviewed_by  uuid references public.app_user(id),
  reviewed_at  timestamptz not null default now(),
  primary key (tenant_id, card_fp, other_fp)
);

alter table public.analysis_doc    enable row level security;
alter table public.analysis_review enable row level security;
alter table public.analysis_dup_review enable row level security;
create policy analysis_doc_admin        on public.analysis_doc        for all using (is_admin()) with check (is_admin());
create policy analysis_review_admin     on public.analysis_review     for all using (is_admin()) with check (is_admin());
create policy analysis_dup_review_admin on public.analysis_dup_review for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- 4. Let the job table record an analysis run.
-- ---------------------------------------------------------------------------
alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales','cards','parse_application','analysis'));
