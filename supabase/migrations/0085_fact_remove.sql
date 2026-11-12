-- 0085: client self-serve fact removal (patch 35, 12 Nov 2026).
--
-- Shane's call, same day as 0084: routing every correction through For
-- Granted does not scale, and a REMOVAL never breaks the provenance rule
-- (nothing new is asserted; the client declines to be searched on one fact).
-- So the review ladder gains a third state. 'removed' facts sit out of every
-- search and query build, render struck through on the matching-profile page
-- with an Undo, and For Granted is notified informationally. Edits proper
-- still go through For Granted or the v2 evidence path.

alter table profile_fact_review drop constraint if exists profile_fact_review_state_check;
alter table profile_fact_review add constraint profile_fact_review_state_check
  check (state in ('confirmed','flagged','removed'));

comment on column public.profile_fact_review.state is
  'confirmed: the client stamped it right. flagged: reads wrong, For Granted asked to look. removed (0085): the client took it out of their searches themselves; undoable, keyed to the fact''s content hash, so a rebuilt fact with a changed quote returns as new.';
