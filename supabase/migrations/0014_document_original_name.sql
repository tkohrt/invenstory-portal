-- Preserve the original uploaded filename so downloads keep the true extension.
alter table public.document add column if not exists original_name text;
-- Backfill from title where the title already carries a known extension.
update public.document set original_name = title
where original_name is null
  and title ~* '\.(pdf|docx?|xlsx?|txt|md|html?|mp3|m4a|wav)$';
