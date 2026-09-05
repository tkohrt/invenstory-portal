-- Whether this organization has ever granted money to anyone.
--
-- A live find_funders call for Ohio private foundations returned twenty
-- results, twelve of which had has_grant_history false: organizations with no
-- recorded outgoing grants at all, sitting in a funder table. Semantic search
-- matches mission text, and an operating charity's mission text reads exactly
-- like a funder's, because they describe the same work from opposite sides of
-- the cheque.
--
-- Nullable on purpose, with three meanings:
--   true   the dataset records outgoing grants
--   false  the dataset records none. Hidden by default, not deleted
--   null   the field was absent. Never hide on an absent field; a funder For
--          Granted added by hand has no such flag and must not vanish
--
-- Marked rather than filtered out at write time, for two reasons. A row that
-- procures services rather than granting them is still useful to a client who
-- can bid. And a screen nobody can see through is a screen nobody can tell is
-- wrong.

alter table public.matched_funder add column if not exists has_grant_history boolean;

comment on column public.matched_funder.has_grant_history is
  'From the source record. false means no outgoing grants on file, and the row is hidden behind a toggle rather than dropped. null means unknown: never hide on it.';
