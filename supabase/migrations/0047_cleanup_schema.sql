-- 0047_cleanup_schema.sql
--
-- Portal cleanup, part 2 of 2: schema. Run AFTER the cleanup release is live
-- (the code before it still reads draft_bracket, so dropping it first would
-- break the Drafts page for a few minutes).
--
-- Every draft is now a Storyboarding Tool draft, so:
--   * draft_bracket (the bracket questions) is dropped. 0046 emptied it.
--   * grant_draft.body (the bracket narrative) is dropped; nothing reads it.
--   * grant_draft.mode can only be 'cards', and defaults to it.
--   * Drafts are For Granted only: a client session reads no drafts. (Before,
--     clients could read bracket drafts and nothing else.)

drop table if exists public.draft_bracket;

alter table public.grant_draft drop column if exists body;

alter table public.grant_draft alter column mode set default 'cards';
alter table public.grant_draft drop constraint if exists grant_draft_mode_check;
alter table public.grant_draft add constraint grant_draft_mode_check check (mode = 'cards');

drop policy if exists grant_draft_select on public.grant_draft;
create policy grant_draft_select on public.grant_draft for select using (is_admin());
