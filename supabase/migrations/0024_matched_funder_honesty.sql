-- Two columns the funder table needs to stop overclaiming.
--
-- evidence_count: the rendered list is read back through PostgREST, which
-- cannot order by the length of a jsonb array. So the "more peer grantees
-- first" ranking that funderRowsFrom computes was being discarded on the way
-- to the page, and a funder with one peer outranked one with twelve whenever
-- its name sorted earlier. Store the count and order by it.
--
-- from_overlay: an approved Ground Truth funder reaches EVERY tenant's
-- matching by design — it is shared For Granted IP. Grants survive that
-- because they are screened against the client's own eligibility profile.
-- Funders are not screened at all, so an FG-discovered funder was appearing
-- on a client's page under a badge claiming its focus aligned with that
-- client, when nothing had assessed the two against each other. The row still
-- belongs there; the claim does not. This marks it so the page can say what
-- it actually is.

alter table public.matched_funder add column if not exists evidence_count integer not null default 0;
alter table public.matched_funder add column if not exists from_overlay boolean not null default false;

comment on column public.matched_funder.evidence_count is
  'length(evidence), stored so the list can be ordered by it. PostgREST cannot sort on jsonb array length.';
comment on column public.matched_funder.from_overlay is
  'True when this funder came from For Granted''s own Ground Truth records rather than from a match against this client. Nothing has assessed it against this client, and the page must not imply otherwise.';
