-- The Search Profile: what we say about a client when we go looking for money.
--
-- Until now the query sent to the Ledger was built from a dozen eligibility
-- fields, and the client's Inven(s)tory, which is the whole point of this
-- product, was used only to explain matches after the fact. This caches the
-- distillation that changes that.
--
-- Cached rather than computed per run for three reasons: it is an LLM pass over
-- every document, it changes only when documents change, and a match run should
-- not wait on it.
--
-- `facts` is the list from lib/search-profile.ts: facet, text, verbatim quote,
-- document id and title, layer, and the subject tag that decides whether a line
-- may describe the client at all. Every line carries its quote, so a query can
-- always be traced back to the sentence that produced it.
--
-- `doc_fingerprint` is how staleness is noticed: it hashes the set of ready
-- documents, so adding or removing one marks the profile out of date without
-- anybody having to remember.

create table if not exists public.search_profile (
  tenant_id       uuid primary key references public.tenant(id) on delete cascade,
  facts           jsonb not null default '[]'::jsonb,
  document_count  integer not null default 0,
  layers          text[] not null default '{}',
  doc_fingerprint text,
  -- Plain sentence about what this was built from, and what is missing.
  note            text,
  generated_at    timestamptz not null default now(),
  generated_by    uuid references public.app_user(id)
);

comment on table public.search_profile is
  'Per-tenant distillation of the Inven(s)tory used to build funder and grant queries. One row per tenant, regenerated when documents change.';
comment on column public.search_profile.facts is
  'ProfileFact[]: {facet, text, quote, documentId, documentTitle, layer, subject}. Only subject=organization may describe the client in a query.';
comment on column public.search_profile.doc_fingerprint is
  'Hash of the ready-document set. A mismatch means the profile is stale.';

alter table public.search_profile enable row level security;
create policy search_profile_select on public.search_profile for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy search_profile_write on public.search_profile for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
