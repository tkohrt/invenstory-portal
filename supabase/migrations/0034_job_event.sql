-- What happened, in order.
--
-- The job row holds ONE `detail` string, overwritten on every step. The moment
-- step two starts, step one is gone, so nothing anywhere records what a run
-- actually did. That is not only a display problem.
--
-- When the Search Profile build stalled at 5 of 15, two invocations ran for
-- about fifty seconds each and left no trace at all. Working out what they had
-- done meant reading extracted_at timestamps out of search_profile_doc and
-- correlating them against deployment logs by hand. An append-only log would
-- have said "read nothing this pass" on the screen, at the time, to the person
-- watching.
--
-- So: events accumulate, `detail` stays as the one-line summary for the
-- collapsed view, and the two do not compete.
--
-- ADMIN ONLY, deliberately and separately from the job row itself. A client may
-- watch their own match run through job; these events name documents from their
-- Inven(s)tory and describe how For Granted works, which is the same reasoning
-- that already keeps a search_profile job's detail away from client sessions.

create table if not exists public.job_event (
  id        bigserial primary key,
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  job_id    uuid not null references public.job(id) on delete cascade,

  -- Ordering and the paging cursor are both the bigserial id. A per-job
  -- counter would have to be read before every insert, and these writes are
  -- fire-and-forget from inside a loop, so two in flight at once would collide
  -- and one line would silently vanish. The sequence cannot collide.

  -- How the line should read, not what it says. The wording lives in the app
  -- where it can be changed without a migration; this is the part the interface
  -- styles on and the part that survives a rewording.
  --   phase    a stage beginning: reading, assembling, searching
  --   progress one unit of work finished
  --   skip     deliberately not done, with the reason
  --   pause    a stage stopped short, normally the function's time limit
  --   warn     something survivable that a person should know about
  --   error    the run stopped here
  --   done     the run finished
  kind      text not null check (kind in ('phase','progress','skip','pause','warn','error','done')),
  text      text not null,

  -- Where the run stood when this line was written, so a log read on its own
  -- shows the count climbing without recomputing anything.
  done      integer,
  total     integer,

  at        timestamptz not null default now()
);

comment on table public.job_event is
  'Append-only narration of a job, admin-visible only. The job row keeps the latest one-line detail; this keeps the order of everything that happened.';

create index if not exists job_event_tenant_job_idx on public.job_event (tenant_id, job_id, id);

alter table public.job_event enable row level security;

-- Narrower than the job policy on purpose. job is readable by the tenant that
-- owns it; this is not.
create policy job_event_admin_select on public.job_event for select
  using (is_admin());
create policy job_event_admin_write on public.job_event for all
  using (is_admin()) with check (is_admin());
