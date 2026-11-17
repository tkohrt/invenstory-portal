-- 0096: the RFP Engine's run (patch 58, 17 Nov 2026).
--
-- Plan: project doc "RFP Engine, Portal Integration and Build Plan (16 November
-- 2026)", section 4, steps 1 and 3. Three pieces:
--   rfp_profile      per client: what the fit step reads (capabilities), and
--                    what the candidate pull searches on (NAICS codes, keywords).
--   rfp_candidates() the candidate pull: cheap SQL over the shared index, no
--                    model calls.
--   rfp_eligible.notice_hash  the notice's content hash when it was scored, so
--                    an unchanged notice keeps its fit next week without a
--                    second model call.
--
-- Additive only: one new table, one new function, two new columns.

-- --------------------------------------------------------------- rfp_profile
create table if not exists public.rfp_profile (
  tenant_id     uuid primary key references public.tenant(id) on delete cascade,
  -- What the client sells and has shipped, in plain sentences. The fit step
  -- judges every notice against this text and must quote it.
  capabilities  text not null default '',
  naics         text[] not null default '{}',
  keywords      text[] not null default '{}',
  updated_by    uuid references public.app_user(id) on delete set null,
  updated_at    timestamptz not null default now()
);

alter table public.rfp_profile enable row level security;
create policy rfp_profile_select on public.rfp_profile for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy rfp_profile_write on public.rfp_profile for all
  using (is_admin()) with check (is_admin());

-- ------------------------------------------------------- rfp_eligible column
alter table public.rfp_eligible add column if not exists notice_hash text;
-- The fit step's "could a response shape the requirement?" for an RFI, kept so
-- a reused fit reaches the same verdict.
alter table public.rfp_eligible add column if not exists shapeable boolean not null default false;

-- ------------------------------------------------------------ rfp_candidates
-- Open notices that match a client's NAICS codes or keywords. Excluded:
-- grants (the grants track has them), awards and justifications (nothing to
-- bid), amendments (the base notice carries the opportunity), surplus sales
-- and bundling notices. A notice with no response date counts only while it
-- is fresh (posted in the last 120 days), so stale undated rows age out.
-- Keywords match the title or description, case-insensitive, as plain text.
create or replace function public.rfp_candidates(p_naics text[], p_keywords text[], p_limit integer)
returns table (
  id uuid, source_id uuid, source_kind text, notice_id text, title text, agency text,
  notice_type text, notice_type_raw text, naics text[], set_aside text,
  posted_at timestamptz, due_at timestamptz, due_date_only boolean,
  description text, description_url text, evidence_tier text, content_hash text,
  naics_match boolean
)
language sql stable
set search_path = public
as $$
  with kw as (
    select '%' || replace(replace(replace(k, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
    from unnest(coalesce(p_keywords, '{}')) as k
    where length(trim(k)) >= 3
  )
  select n.id, n.source_id, s.kind, n.notice_id, n.title, n.agency,
         n.notice_type, n.notice_type_raw, n.naics, n.set_aside,
         n.posted_at, n.due_at, n.due_date_only,
         n.description, n.description_url, n.evidence_tier, n.content_hash,
         (n.naics && coalesce(p_naics, '{}')) as naics_match
  from rfp_notice n
  join rfp_source s on s.id = n.source_id and s.enabled
  where n.status = 'active'
    and s.kind <> 'grants_gov'
    and n.notice_type not in ('award', 'justification', 'amendment', 'surplus_sale', 'bundle', 'grant')
    and (n.due_at > now() or (n.due_at is null and n.posted_at > now() - interval '120 days'))
    and (
      n.naics && coalesce(p_naics, '{}')
      or exists (select 1 from kw where n.title ilike kw.pat or n.description ilike kw.pat)
    )
  order by (n.naics && coalesce(p_naics, '{}')) desc, n.due_at asc nulls last, n.posted_at desc nulls last
  limit least(greatest(coalesce(p_limit, 80), 1), 200);
$$;

-- Only the server (service role) and For Granted call it.
revoke all on function public.rfp_candidates(text[], text[], integer) from public, anon, authenticated;
grant execute on function public.rfp_candidates(text[], text[], integer) to service_role;
