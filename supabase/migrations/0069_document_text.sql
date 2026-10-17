-- 0069 Document Reader, Phase 0: one stored text per document version.
--
-- ADDITIVE. One new table, empty until the backfill (Admin, Analysis, "Store
-- document text") or the next upload fills it. The job kind list is widened by
-- one value ('doc_text', the backfill): the rule is replaced by one that allows
-- everything it allowed before, so no existing job row is touched. Nothing
-- existing is changed or deleted. Reversible: drop the table, and put the old
-- job rule back once no 'doc_text' job remains.
--
-- document_text.text is THE text of that version of the document: pages joined
-- with a blank line, carriage returns removed, control characters stripped
-- (lib/doc-text.ts). document_chunk.char_start/char_end point into it exactly
-- for documents read after Phase 0, and for older documents once the backfill
-- has re-pointed them (chunks_aligned). Every reader reads this text, so a
-- quote checked by the analysis is located in the same text the reader shows.

create table if not exists public.document_text (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  document_id     uuid not null references public.document(id) on delete cascade,
  version         int  not null default 1,
  text            text not null,
  text_hash       text not null,
  -- [{ "page": 1, "start": 0, "end": 1834 }, ...]; page is null for kinds with no pages.
  pages           jsonb not null default '[]'::jsonb,
  origin          text not null default 'extracted' check (origin in ('extracted', 'edited')),
  -- false when the document's passages could not be re-pointed into this text
  -- (the re-extracted text differs from what was read before); Re-process fixes it.
  chunks_aligned  boolean not null default true,
  created_by      uuid references public.app_user(id),
  created_at      timestamptz not null default now(),
  unique (document_id, version)
);

create index if not exists document_text_tenant_idx on public.document_text (tenant_id);

alter table public.document_text enable row level security;

-- Readable like the document's passages (document_chunk): the client's own, and
-- For Granted. Written only by the server (ingestion and the backfill).
create policy document_text_select on public.document_text for select
  using (tenant_id = current_tenant_id() or is_admin());

alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales','cards','parse_application','analysis','autodraft','doc_text'));
