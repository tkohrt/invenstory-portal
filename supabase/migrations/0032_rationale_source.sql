-- Which explanations still owe a real answer.
--
-- Rationales are the long tail of a match run: a model call per batch of eight,
-- and the step most likely to be cut off when a run hits the function limit. A
-- killed run leaves some matches explained and some not, and until now those
-- were indistinguishable from the ones we deliberately chose not to explain.
--
-- Three states, and the distinction is the point:
--   llm      a real, grounded explanation. Done.
--   rule     deliberately rule-based. No generation configured, or the model
--            cited a document that does not exist and we refused it. Also done:
--            retrying would produce the same refusal.
--   pending  never got one. This is the resumable set.
--
-- Without the split, resuming would either retry the deliberate refusals
-- forever or skip the genuinely unfinished ones.

alter table public.eligible_grant add column if not exists rationale_source text
  check (rationale_source in ('llm','rule','pending'));

comment on column public.eligible_grant.rationale_source is
  'llm = real grounded explanation; rule = deliberately rule-based and final; pending = the run was cut short before reaching it.';

create index if not exists eligible_grant_pending_rationale_idx
  on public.eligible_grant (tenant_id) where rationale_source = 'pending';

-- The follow-on job that fills them in.
alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales'));
