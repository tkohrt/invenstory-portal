-- Web discovery (patch 5 of the 1 November 2026 build).
--
-- A few web searches seeded from a client's profile find what is open now:
-- the half of Tyler's process that ran in a separate deep research report.
-- Every find is kept for the client it was found for, and filed into the
-- Ground Truth review queue as a PROPOSAL; nothing reaches another client
-- until a person approves it. Additive: two new tables, one job kind and one
-- provenance value. No existing row changes.

-- One run: the questions planned for it and the ones already asked. A run is
-- asked one question per request (each is a model call that searches the web,
-- 20 to 40 seconds), so the page carries it question by question.
create table if not exists public.discovery_run (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  angles       jsonb not null default '[]'::jsonb,   -- [{key, kind, question}]
  done         jsonb not null default '[]'::jsonb,   -- keys asked so far
  found        int not null default 0,
  proposed     int not null default 0,
  searches     int not null default 0,
  note         text,
  started_by   uuid references public.app_user(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists discovery_run_tenant_idx on public.discovery_run (tenant_id, started_at desc);

-- What was found, per client. One row per page (url_key), refreshed when a
-- later run finds it again, so a client's list does not fill with repeats.
create table if not exists public.discovered_lead (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  run_id        uuid references public.discovery_run(id) on delete set null,
  angle         text,
  kind          text not null check (kind in ('opportunity','funder')),
  money_kind    text not null default 'grants',
  title         text not null,
  funder        text,
  url           text not null,
  url_key       text not null,
  deadline      date,
  rolling       boolean not null default false,
  amount_text   text,
  geography     text,
  eligibility   text,
  why           text,
  quote         text,
  -- exact: a page the search returned. site: only its website was, so the link
  -- is For Granted's to check and clients do not see the row.
  grounded      text not null check (grounded in ('exact','site')),
  overlay_id    uuid references public.ledger_overlay(id) on delete set null,
  found_at      timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (tenant_id, url_key)
);
create index if not exists discovered_lead_tenant_idx on public.discovered_lead (tenant_id, found_at desc);

alter table public.discovery_run enable row level security;
alter table public.discovered_lead enable row level security;

-- A client reads its own; only the server writes (service role) and For
-- Granted manages. The "site" rows are filtered out for clients in the
-- application as well, where the reason can be explained.
drop policy if exists discovery_run_select on public.discovery_run;
create policy discovery_run_select on public.discovery_run for select
  using (tenant_id = current_tenant_id() or is_admin());
drop policy if exists discovery_run_admin on public.discovery_run;
create policy discovery_run_admin on public.discovery_run for all
  using (is_admin()) with check (is_admin());

drop policy if exists discovered_lead_select on public.discovered_lead;
create policy discovered_lead_select on public.discovered_lead for select
  using (tenant_id = current_tenant_id() or is_admin());
drop policy if exists discovered_lead_admin on public.discovered_lead;
create policy discovered_lead_admin on public.discovered_lead for all
  using (is_admin()) with check (is_admin());

-- The job that carries a run.
alter table public.job drop constraint if exists job_kind_check;
alter table public.job add constraint job_kind_check
  check (kind in ('match','search_profile','readiness','rationales','cards','parse_application','analysis','autodraft','doc_text','discover'));

-- Where a Ground Truth proposal came from: now also the web search.
alter table public.ledger_overlay drop constraint if exists ledger_overlay_provenance_check;
alter table public.ledger_overlay add constraint ledger_overlay_provenance_check
  check (provenance in ('client_surfaced','scout_bot','manual','web_discovery'));
