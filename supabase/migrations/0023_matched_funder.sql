-- Track B: the funder half of matching, persisted.
--
-- Until now runMatch computed funder matches and threw them away — the results
-- were counted in a sentence and never stored or shown. That made the funder
-- side of Ground Truth write-only: a verification recorded through the picker
-- was approved and then reached no view, because there was no view.
--
-- Funders are a genuinely different object from solicitations. A grant has a
-- deadline and a verdict; a funder has an access mode, a giving range and a
-- history of who it already funds. Trying to force them into eligible_grant
-- would mean a table where half the columns are null for half the rows.
--
-- `ein` is the identity and the merge key: it is what FunderPicker writes into
-- ledger_overlay.base_id, so a correction lands on the record it was attached
-- to. It is nullable because the graph returns funders without one; those
-- cannot be corrected, and the primary key falls back to a synthetic id.

create table if not exists public.matched_funder (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  funder_id     text not null,          -- ein when known, else a slug of the name
  ein           text,
  name          text not null,
  website       text,
  location      text,
  focus         text,
  mission       text,
  typical_grant_range text,

  -- Why this funder, in two forms: the service's own reason, and the graph
  -- evidence that it already writes cheques to organizations like this one.
  match_reason  text,
  confidence    text,
  -- Relayed verbatim, never paraphrased: a donor-advised fund is not an
  -- approachable foundation, and softening that wastes a client's time.
  caveat        text,
  evidence      jsonb not null default '[]'::jsonb,
  -- True when this funder came from the who-funds-whom graph rather than from
  -- semantic search. The two answer different questions and must not be blended.
  from_graph    boolean not null default false,

  -- When For Granted last confirmed this record at the funder's own site,
  -- sourced from the approved Ground Truth correction. Null means unverified.
  verified_at   timestamptz,
  matched_at    timestamptz not null default now(),
  primary key (tenant_id, funder_id)
);

comment on table public.matched_funder is
  'Funder matches per tenant (Track B). A run is a snapshot: rows older than the current run are swept.';
comment on column public.matched_funder.funder_id is
  'EIN when known, else a name slug. Must equal the id mergeOverlay keys on, so a Ground Truth correction reaches this record.';
comment on column public.matched_funder.evidence is
  'Peer grantees from the graph: [{name, amount_usd, years}]. Evidence for an approach, not a guarantee.';

create index if not exists matched_funder_tenant_idx on public.matched_funder (tenant_id, matched_at desc);

alter table public.matched_funder enable row level security;
create policy matched_funder_select on public.matched_funder for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy matched_funder_write on public.matched_funder for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
