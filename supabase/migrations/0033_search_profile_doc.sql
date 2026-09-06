-- One document's worth of Search Profile facts.
--
-- The profile build was all-or-nothing: every document read into memory, one
-- write at the end. RE-Assist's Inven(s)tory is 15 documents and about 37 model
-- windows, which is two to three minutes of work. No function budget survives
-- that, so the build could never finish and every attempt threw away everything
-- it had already read.
--
-- Splitting it per document fixes three things at once. The work becomes
-- resumable, because a killed pass keeps what it finished. It becomes
-- incremental, because adding one transcript costs one document's worth of
-- reading rather than a full rebuild. And one document that makes the model
-- choke stops losing the whole pass.
--
-- This is safe here in a way it would not be for a match run. A profile is an
-- accumulation, not a snapshot: reading document 4 does not depend on document
-- 3, and there is no sweep that a partial pass corrupts.

create table if not exists public.search_profile_doc (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  document_id  uuid not null references public.document(id) on delete cascade,
  -- ProfileFact[] for this document alone. Assembled into search_profile.facts
  -- once every document is read.
  facts        jsonb not null default '[]'::jsonb,
  -- What was read, so a changed document can be spotted and re-read rather than
  -- trusted forever.
  chars        integer not null default 0,
  windows      integer not null default 0,
  extracted_at timestamptz not null default now(),
  primary key (tenant_id, document_id)
);

comment on table public.search_profile_doc is
  'Per-document Search Profile facts. Makes the build resumable and incremental: adding a document costs one document of work, not a full rebuild.';

create index if not exists search_profile_doc_tenant_idx on public.search_profile_doc (tenant_id);

alter table public.search_profile_doc enable row level security;
create policy search_profile_doc_select on public.search_profile_doc for select
  using (tenant_id = current_tenant_id() or is_admin());
create policy search_profile_doc_write on public.search_profile_doc for all
  using (tenant_id = current_tenant_id() or is_admin())
  with check (tenant_id = current_tenant_id() or is_admin());

-- A lease, so two tabs continuing the same chain cannot double the work.
alter table public.job add column if not exists claimed_at timestamptz;
comment on column public.job.claimed_at is
  'Set while an invocation is actively working this job. A continuation whose claim is fresh is refused, so two tabs cannot read the same documents twice.';
