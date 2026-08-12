-- Allow the 'rtf' document kind (added to the accepted-upload set in the
-- client + server allowlist). Previously the CHECK constraint rejected it.
alter table public.document drop constraint if exists document_doc_kind_check;
alter table public.document add constraint document_doc_kind_check
  check (doc_kind in ('pdf','docx','web','note','xlsx','audio','rtf'));
