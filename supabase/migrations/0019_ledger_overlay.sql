-- The Funder Ledger "living overlay".
--
-- The GrantX/Funder Ledger base is a frozen June 2026 snapshot hosted as a
-- separate read-only service. It is NEVER mutated. This overlay is the
-- writable, FG-curated layer that heals it: verified corrections to base
-- records and brand-new records FG discovers. At query time the portal merges
-- base + overlay with the overlay winning, so the Ledger effectively repairs
-- itself without the base ever changing.
--
-- Two feeds write here, both gated by human review (nothing auto-updates):
--   client_surfaced  -- FG verified a grant while working a client
--   scout_bot        -- the scheduled discovery bot
--   manual           -- an admin typed it in
--
-- NOT tenant-scoped. This is For Granted IP shared across all clients;
-- `surfaced_for_tenant` only records which engagement produced the record.
-- RLS is admin-only: clients never see or edit the overlay. Because there is
-- no tenant_id, this table is deliberately absent from the TENANT_SCOPED list
-- in scripts/check-tenant-scoping.mjs.

create table if not exists public.ledger_overlay (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('funder','grant')),
  base_id             text,            -- Ledger id this corrects; null = brand-new
  ein                 text,            -- funder join/dedupe key
  opportunity_number  text,            -- grant identifier
  title               text,            -- human label for the review queue
  fields              jsonb not null default '{}'::jsonb,  -- curated values: {name, eligibility, close_date, award_ceiling, website, org_types_allowed, geography, ...}
  source_url          text not null,   -- where it was verified (the durable part)
  provenance          text not null check (provenance in ('client_surfaced','scout_bot','manual')),
  surfaced_for_tenant uuid references public.tenant(id) on delete set null,
  status              text not null default 'proposed'
                        check (status in ('proposed','in_review','approved','rejected','superseded')),
  confidence          text check (confidence in ('high','medium','low')),
  proposed_by         uuid references public.app_user(id),
  reviewed_by         uuid references public.app_user(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists ledger_overlay_status_idx    on public.ledger_overlay (status);
create index if not exists ledger_overlay_kind_base_idx on public.ledger_overlay (kind, base_id);
create index if not exists ledger_overlay_ein_idx       on public.ledger_overlay (ein);
create index if not exists ledger_overlay_tenant_idx    on public.ledger_overlay (surfaced_for_tenant);
-- The merge path reads only approved rows; keep that lookup cheap.
create index if not exists ledger_overlay_approved_idx  on public.ledger_overlay (kind) where status = 'approved';

-- At most one approved correction per base record, enforced in the database.
-- The supersede sweep in approveOverlayAction is application-level and can be
-- bypassed by a direct SQL or bot write; this is the real guarantee, and it is
-- what lets the merge stop guessing which of two approvals wins.
create unique index if not exists ledger_overlay_one_approved_idx
  on public.ledger_overlay (kind, base_id)
  where status = 'approved' and base_id is not null;

drop trigger if exists ledger_overlay_updated_at on public.ledger_overlay;
create trigger ledger_overlay_updated_at before update on public.ledger_overlay
  for each row execute function public.set_updated_at();

-- One row per discovery-bot run, for observability + the review-queue header.
create table if not exists public.ledger_scout_run (
  id         uuid primary key default gen_random_uuid(),
  ran_at     timestamptz not null default now(),
  scope      text,            -- 'active_clients' | 'full' | a tenant id
  checked    int not null default 0,   -- records re-verified
  found_new  int not null default 0,   -- brand-new candidates
  proposed   int not null default 0,   -- rows written to the queue
  summary    text
);
create index if not exists ledger_scout_run_ran_at_idx on public.ledger_scout_run (ran_at desc);

alter table public.ledger_overlay   enable row level security;
alter table public.ledger_scout_run enable row level security;

drop policy if exists overlay_admin on public.ledger_overlay;
create policy overlay_admin on public.ledger_overlay
  for all using (is_admin()) with check (is_admin());

drop policy if exists scout_admin on public.ledger_scout_run;
create policy scout_admin on public.ledger_scout_run
  for all using (is_admin()) with check (is_admin());
