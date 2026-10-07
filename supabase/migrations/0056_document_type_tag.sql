-- 0056_document_type_tag.sql
--
-- Inven(s)tory Analysis, Phase D, patch 5: document types set by a person
-- (Build Decision 33).
--
-- What this makes possible:
--   * Each document can carry the type a person gave it: picked at upload,
--     confirmed from the analysis's suggestion, or chosen from the list.
--   * Readiness items that are a file (a 990, a pitch deck, a budget, a board
--     roster, a financial model) are covered only by a document tagged as that
--     type. Until a document is tagged, those items stay missing.
--   * Who tagged it and when, so a client cannot overwrite For Granted's tag.
--
-- ADDITIVE. Three new nullable columns on document. No existing row changes.
-- Readable and writable exactly as the rest of the row is today (the document
-- table's existing policies). Reversible by dropping the columns.

alter table public.document add column if not exists type_tag       text;
alter table public.document add column if not exists type_tagged_by uuid references public.app_user(id);
alter table public.document add column if not exists type_tagged_at timestamptz;
