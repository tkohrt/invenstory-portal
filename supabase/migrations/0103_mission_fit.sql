-- 0103 Mission fit (patch 70, 19 November 2026).
--
-- A lead from a watched source was shown to every client eligible to apply
-- for it. Eligible is not relevant: a youth-mentoring nonprofit was shown a
-- clinical-trials programme. curated_match.mission_fit records whether a lead
-- suits the client's own work, judged against the matching profile built from
-- its Inven(s)tory:
--   true   on mission: shown to the client
--   false  off mission: kept on file so it is not judged again, never shown
--   null   not judged. For a lead from a watched source that means not shown
--          yet. For an entry from a hand-curated list it means what it always
--          did: shown (those lists are chosen by a person, for these clients).
--
-- Additive, and safe to run more than once. Matches written before this
-- migration are left as null, so the leads from sources that reached clients
-- on 19 November come off their pages until each has been judged.

alter table public.curated_match
  add column if not exists mission_fit boolean;

notify pgrst, 'reload schema';
