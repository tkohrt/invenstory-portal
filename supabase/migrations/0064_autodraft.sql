-- 0064_autodraft.sql
--
-- Auto-Draft, patch 6: Auto-Arrange (Auto-Draft build spec, sections 4, 5,
-- 10 and 11; 12 October 2026).
--
-- What this makes possible:
--   * grant_draft.auto_drafted_at: set when an auto-draft run first changes a
--     draft. While it is set, Begin Weaving and Begin Polishing no longer
--     refuse over cards that need review for that draft (a retired card still
--     stops them). The finish line is unchanged.
--   * A new job kind, 'autodraft', so a whole-draft run is carried by the
--     server one question at a time, like the Card Library build, with its
--     progress in the portal-wide build notice.
--
-- ADDITIVE. One new nullable column on grant_draft (empty for every existing
-- draft). The job kind list is widened by one value: the rule is replaced by
-- one that allows everything it allowed before plus 'autodraft', so no
-- existing job row is touched or could fail it. Reversible: drop the column,
-- and put the old rule back once no 'autodraft' job remains.

alter table public.grant_draft add column if not exists auto_drafted_at timestamptz;

alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales','cards','parse_application','analysis','autodraft'));
