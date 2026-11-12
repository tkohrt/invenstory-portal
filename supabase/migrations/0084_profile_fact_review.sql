-- 0084: matching-profile fact reviews (patch 34, 12 Nov 2026).
--
-- The "Your matching profile" page (decided 10 Nov) shows the Search Profile
-- fact by fact with the quote behind each. V1 gives the client two verbs:
-- CONFIRM (a stored stamp; becomes weighting signal later) and FLAG (pings
-- For Granted). Deliberately NOT an edit path: a client correction is new
-- evidence for the Inven(s)tory, not an edit to the profile, so the profile
-- can never assert what no document supports. fact_id is the stable hash of
-- (document, facet, quote), so a rebuilt profile keeps stamps for unchanged
-- facts and a changed quote arrives unconfirmed, which is correct.

create table if not exists public.profile_fact_review (
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  fact_id   text not null,
  state     text not null check (state in ('confirmed','flagged')),
  note      text,
  by_user   uuid references public.app_user(id) on delete set null,
  at        timestamptz not null default now(),
  primary key (tenant_id, fact_id)
);

comment on table public.profile_fact_review is
  'Per-fact client review of the matching profile (patch 34): confirmed stamps and flags for For Granted. Keyed by factId(document, facet, quote), so stamps survive rebuilds only while the fact itself is unchanged.';

alter table public.profile_fact_review enable row level security;
create policy profile_fact_review_select on public.profile_fact_review for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy profile_fact_review_write on public.profile_fact_review for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());
