-- 0066_suggested_wording.sql
--
-- Auto-Draft, patch 8: suggested wording on a card (Auto-Draft build spec,
-- sections 4 step 3, 5, 6 and 10; 14 October 2026).
--
-- What this makes possible:
--   * section_block.suggested_text and suggested_at: new wording auto-draft
--     suggests for a card placed in an answer. The card's own wording stays in
--     the answer until a person accepts (the suggestion becomes the draft's own
--     edit of that card), rejects (it is cleared) or edits it first. A
--     suggestion nobody has dealt with is a finish-line issue.
--   * Three new kinds of card_event: wording_suggested, wording_accepted,
--     wording_rejected (the record the learning loop will use).
--
-- ADDITIVE. Two new nullable columns, empty on every existing row. The
-- card_event rule is replaced by one allowing everything it allowed before
-- plus the three new kinds, so no existing row is touched or could fail it.
-- Reversible: drop the two columns, and put the old rule back once no row
-- uses the new kinds.

alter table public.section_block add column if not exists suggested_text text;
alter table public.section_block add column if not exists suggested_at timestamptz;

alter table public.card_event drop constraint if exists card_event_event_check;
alter table public.card_event add constraint card_event_event_check
  check (event in ('shown','added','removed','reordered','edited','proposed_to_library',
    'bridge_proposed','bridge_accepted','bridge_rejected','bridge_edited','trim_accepted','trim_rejected',
    'sa_adapted','sa_kept_local','sa_update_requested','sa_reverted',
    'wording_suggested','wording_accepted','wording_rejected'));
