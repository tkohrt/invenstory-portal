-- For Granted's judgment over the extracted profile.
--
-- The extractor gets things wrong in ways no prompt will fully fix. A real
-- example from RE-Assist: a call transcript produced "mentored and advised
-- hundreds and hundreds of companies pitch presentations" as the client's own
-- EVIDENCE. The quote behind it is "I've mentored and seen and advised and
-- reviewed hundreds and hundreds of companies", said by somebody else on the
-- call about their own career. A meeting has several people in it, the reader
-- never sees who is speaking, and it defaults to the client. That line went
-- into a live search query as a credential the client does not have.
--
-- A person removes it in four seconds. So this table is the place they do it.
--
-- SEPARATE FROM THE PROFILE ROW, which is the whole design. search_profile is
-- rebuilt wholesale by every Rebuild and re-merge, so an edit written there
-- would be silently erased the next time anyone pressed a button. Corrections
-- live here and are merged over the base at read time. Same pattern as the
-- funder overlay: base underneath, judgment on top, and the interface says
-- which is which rather than passing one off as the other.
--
-- Keyed by fact_id, a hash of document, facet and quote. Stable across
-- rebuilds because all three are stable: re-reading the same document produces
-- the same quote for the same facet, so a correction reattaches to the line it
-- was made against rather than drifting onto its neighbour.
--
-- ADMIN ONLY. This is For Granted's working view of a client's Inven(s)tory.

create table if not exists public.profile_edit (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenant(id) on delete cascade,

  -- Hash of documentId + facet + quote for a base fact. For an added line,
  -- a generated id that no base fact will ever collide with.
  fact_id    text not null,

  --   hide  the extracted line is wrong or not about this client
  --   edit  the line is about the right thing and says it badly
  --   add   something true that no document states in a usable way
  kind       text not null check (kind in ('hide','edit','add')),

  -- Null for a hide. For an edit, the replacement clause. For an add, the line.
  text       text,
  -- Required for an add, so the facet is known without a base fact to read it
  -- from. Carried on an edit too, so a correction survives a facet changing.
  facet      text check (facet in (
               'identity','work','need','evidence','geography','distinctive',
               'constraints','beneficiaries')),
  -- Why, for the next person. Never shown to a client.
  note       text,

  edited_by  uuid references public.app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One correction per fact per client. Changing your mind updates it.
  unique (tenant_id, fact_id)
);

comment on table public.profile_edit is
  'For Granted corrections to the extracted Search Profile, merged over it at read time. Kept out of search_profile because that row is rebuilt wholesale and an edit written there would be erased by the next Rebuild.';

create index if not exists profile_edit_tenant_idx on public.profile_edit (tenant_id);

alter table public.profile_edit enable row level security;

-- Narrower than the profile itself on purpose: a client never reads or writes
-- this, in the same way they never read a Search Profile job's detail.
create policy profile_edit_admin_select on public.profile_edit for select
  using (is_admin());
create policy profile_edit_admin_write on public.profile_edit for all
  using (is_admin()) with check (is_admin());
