-- 0060_document_outcome.sql
--
-- Auto-Draft, patch 2: document outcomes and the winning tag (Auto-Draft
-- build spec, sections 8 and 10; 12 October 2026).
--
-- What this makes possible:
--   * Each document can record how the grant it holds turned out: won, not
--     funded, pending, or unknown. Set at upload for a past grant application
--     and changed later from the document's drawer, on any document.
--   * "Winning grant" is simply outcome = won. Auto-draft's voice profile
--     (patch 4) will weigh winning sources more than the rest.
--   * Who set it and when, so a client cannot overwrite For Granted's outcome.
--
-- ADDITIVE. Three new nullable columns on document. No existing row changes:
-- every document starts with no outcome. Readable and writable exactly as the
-- rest of the row is today (the document table's existing policies).
-- Reversible by dropping the columns.

alter table public.document add column if not exists outcome        text;
alter table public.document add column if not exists outcome_set_by uuid references public.app_user(id);
alter table public.document add column if not exists outcome_set_at timestamptz;

do $$ begin
  alter table public.document add constraint document_outcome_check
    check (outcome is null or outcome in ('won', 'not_funded', 'pending', 'unknown'));
exception when duplicate_object then null; end $$;
