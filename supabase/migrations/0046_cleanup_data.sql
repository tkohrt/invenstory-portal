-- 0046_cleanup_data.sql
--
-- Portal cleanup, part 1 of 2: data only. Run BEFORE deploying the cleanup
-- release. Safe for the code that is live now and for the new code.
--
-- Deletes, on purpose:
--   * Every bracket-format draft and its bracket questions. There is one: Fund
--     The Climb Foundation's "ODH SUD Transportation Grant", a demo draft on a
--     placeholder account, with 5 unanswered questions and no documents filed
--     from it.
--   * The 20 unreviewed answers the paused Answer Library generator wrote
--     (10 for KHAI Ventures, 10 for For Granted's own account), and their
--     citations. None was ever approved. Approved Standard Answers
--     (status 'published') are not touched; today there are none.
-- answer_event rows are a log and are kept.

delete from public.draft_bracket
where draft_id in (select id from public.grant_draft where mode = 'bracket');

delete from public.grant_draft where mode = 'bracket';

delete from public.answer_citation
where answer_id in (select id from public.answer where source = 'auto' and status <> 'published');

delete from public.answer where source = 'auto' and status <> 'published';

-- Feature switches for sidebar items that no longer exist (none today).
delete from public.feature_visibility where feature_key in ('dashboard', 'answer_library', 'draft_application');
