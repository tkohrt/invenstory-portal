-- For Granted's judgment about a match, captured instead of thrown away.
--
-- The highest-quality signal in this system is somebody looking at a shortlist
-- and knowing that row three is wrong and row seven is worth a call. None of
-- that has ever been recorded. Every run rebuilds the same list, including the
-- rows already judged useless, and the next person starts from scratch.
--
-- TWO VOCABULARIES, ONE TABLE. A funder and a solicitation are different
-- questions. A funder is a relationship you cultivate over months: target it,
-- watch it, approach it, or rule it out. A solicitation is an application you
-- decide about by a date: pin it, review it, reject it. Forcing one vocabulary
-- onto both loses the distinction that matters most, which is that "yes but not
-- this cycle" is the commonest truthful answer about a good funder and has
-- nowhere to live in pin/reject.
--
-- They share a table because the mechanics are identical and a second table
-- would mean two of everything for one idea.
--
-- REASON CODES ARE MANDATORY ON A NEGATIVE VERDICT, and controlled rather than
-- free text. Free text is unlearnable: it cannot suppress, cannot propose a
-- correction, and cannot be counted. The vocabulary is what makes a rejection
-- machine-usable, and it splits along a line that matters:
--
--   FACTS ABOUT THE RECORD, true for every client. Not a grantmaker, defunct,
--   no longer funding, invitation only. These flow into the Ground Truth review
--   queue as PROPOSALS, so client work becomes permanent data. Proposals, not
--   writes: one mistaken click must not change what every client sees.
--
--   JUDGMENTS ABOUT THIS PAIRING. Wrong cause, wrong geography, wrong
--   organization type, grants too small, already declined us, values conflict.
--   True here and nowhere else, so they stay tenant-scoped.
--
-- `values_conflict` is deliberate. A client refusing money from a particular
-- source is a permanent fact about that pairing and there is currently nowhere
-- to record it, so it survives only in somebody's memory.
--
-- ADMIN ONLY for now. A rejection changes what a client sees.

create table if not exists public.match_triage (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,

  -- Which lane. Funders and solicitations are ranked, screened and judged
  -- differently, and the grant index carries no funder id, so the two cannot
  -- be joined into one hierarchy however much one would like to.
  kind        text not null check (kind in ('funder','grant')),

  -- funder_id for a funder (the EIN where there is one), grant_id for a
  -- solicitation. The same key the results tables are stored under, so a
  -- judgment reattaches to the row it was made about on the next run.
  target_id   text not null,
  -- Carried so a suppressed row can be listed by name without resurrecting it
  -- from a run that no longer returns it.
  label       text,

  --   funder: target | watching | approached | not_a_fit
  --   grant:  pinned | under_review | rejected
  -- Enforced in the application rather than here, because the pairing of state
  -- to kind is a rule with a reason and a check constraint cannot explain it.
  state       text not null,

  -- Required when the state rules the row out. See lib/triage.ts.
  reason      text,
  -- Optional colour for the next person. Never a substitute for the code.
  note        text,

  -- Set when a global-fact rejection has been turned into a Ground Truth
  -- proposal, so pressing the same button twice does not queue it twice.
  overlay_id  uuid references public.ledger_overlay(id) on delete set null,

  decided_by  uuid references public.app_user(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One standing judgment per row per client. Changing your mind updates it.
  unique (tenant_id, kind, target_id)
);

comment on table public.match_triage is
  'For Granted judgments about funder and grant matches: relationship stage for funders, application decision for solicitations. Survives a match run, so a rejected row does not come back.';

create index if not exists match_triage_tenant_kind_idx on public.match_triage (tenant_id, kind);

alter table public.match_triage enable row level security;

-- Admin-only, like the profile corrections. A rejection changes what a client
-- sees, so who may make one is a decision to take deliberately rather than by
-- inheriting the tenant policy.
create policy match_triage_admin_select on public.match_triage for select
  using (is_admin());
create policy match_triage_admin_write on public.match_triage for all
  using (is_admin()) with check (is_admin());
