-- 0065_sa_adaptation.sql
--
-- Auto-Draft, patch 7: adapting a pulled-in Standard Answer (Auto-Draft build
-- spec, sections 4b and 10; 12 October 2026).
--
-- What this makes possible:
--   * draft_section.sa_adaptation: on an application question that auto-draft
--     started from an approved Standard Answer and then adapted for this
--     funder, what it came from, the Standard Answer as it was copied in (so
--     "Go back to the Standard Answer" restores it exactly), what changed, and
--     the writer's choice: open (not yet chosen; a finish-line issue), kept
--     (for this grant only), update_requested (also copied into Standard
--     Answers as an unapproved working version), or reverted.
--   * answer.approved_blocks: the pieces of a Standard Answer as they were
--     when approved. Starting from a Standard Answer copies these, so a working
--     version not yet approved again never reaches a new draft ("until then the
--     old approved answer stays in use"). Answers approved before this have
--     none, and are copied from the working version as today.
--   * Four new kinds of card_event: sa_adapted, sa_kept_local,
--     sa_update_requested, sa_reverted.
--
-- ADDITIVE. Two new nullable columns, empty on every existing row. The
-- card_event rule is replaced by one allowing everything it allowed before
-- plus the four new kinds, so no existing row is touched or could fail it.
-- Reversible: drop the two columns, and put the old rule back once no row
-- uses the new kinds.

alter table public.draft_section add column if not exists sa_adaptation jsonb;
alter table public.answer add column if not exists approved_blocks jsonb;

alter table public.card_event drop constraint if exists card_event_event_check;
alter table public.card_event add constraint card_event_event_check
  check (event in ('shown','added','removed','reordered','edited','proposed_to_library',
    'bridge_proposed','bridge_accepted','bridge_rejected','bridge_edited','trim_accepted','trim_rejected',
    'sa_adapted','sa_kept_local','sa_update_requested','sa_reverted'));
