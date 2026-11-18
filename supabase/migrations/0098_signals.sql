-- 0098: signals (patch 64, 18 Nov 2026).
--
-- One place for every recurring source of funding news For Granted watches:
-- pages it re-reads for changes (a funder's or accelerator's own application
-- page, a procurement portal), newsletters arriving at the signals inbox, and
-- Bluesky accounts (patch 65). Each thing a source produces is a "signal". A
-- signal that reads like funding news is parsed by the same parser as a pasted
-- curated list and its entries go to the Ground Truth review queue; nothing
-- reaches a client unreviewed.
--
-- Both tables are For Granted's own shared records: no tenant_id, admin-only.
-- Additive; no existing table changes. Paste BEFORE the deploy.

create table if not exists public.signal_source (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('page','bluesky','email')),
  -- page: the address re-read. bluesky: the handle. email: the sender's address.
  address         text not null,
  label           text not null,
  category        text not null default 'funder' check (category in ('funder','accelerator','rfp','aggregator')),
  -- Inactive sources are kept, not read. A new email sender starts inactive
  -- until For Granted approves it, so a stranger cannot fill the review queue.
  active          boolean not null default true,
  origin          text not null default 'manual' check (origin in ('manual','dossier','follows','inbox')),
  -- The shared funder profile this source belongs to, when a dossier found it.
  funder_key      text,
  -- Health: when it was last tried, last answered, last changed, last produced something.
  last_checked_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_hash       text,
  last_changed_at timestamptz,
  last_signal_at  timestamptz,
  created_by      uuid references public.app_user(id),
  created_at      timestamptz not null default now(),
  unique (kind, address)
);

create table if not exists public.signal (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references public.signal_source(id) on delete cascade,
  -- What makes it one signal: the page's content hash, the email's id, the post's address.
  external_id     text not null,
  seen_at         timestamptz not null default now(),
  title           text,
  excerpt         text,
  url             text,
  -- new: not yet read. filed: new entries went to the review queue. nothing: read,
  -- nothing new in it. skipped: did not read like funding news, not parsed.
  -- held: from a sender not yet approved. failed: could not be read; retried.
  -- reading: claimed by one reader, so two runs never parse the same thing at once.
  status          text not null default 'new' check (status in ('new','reading','filed','nothing','skipped','held','failed')),
  claimed_at      timestamptz,
  curated_list_id uuid references public.curated_list(id) on delete set null,
  entries         integer not null default 0,
  note            text,
  unique (source_id, external_id)
);

create index if not exists signal_seen_idx on public.signal (seen_at desc);

alter table public.signal_source enable row level security;
alter table public.signal enable row level security;

drop policy if exists signal_source_admin_select on public.signal_source;
create policy signal_source_admin_select on public.signal_source for select using (is_admin());
drop policy if exists signal_source_admin_write on public.signal_source;
create policy signal_source_admin_write on public.signal_source for all using (is_admin()) with check (is_admin());

drop policy if exists signal_admin_select on public.signal;
create policy signal_admin_select on public.signal for select using (is_admin());
drop policy if exists signal_admin_write on public.signal;
create policy signal_admin_write on public.signal for all using (is_admin()) with check (is_admin());

-- A starter set of watched pages: accelerators' and funders' OWN application
-- pages, each confirmed to load on 18 Nov 2026. This is the accelerator watch
-- that the Monstream question (17 Nov) asked for, owned by For Granted: the
-- same programmes, read from the source, with nothing depending on anyone
-- else's feed. Add, turn off or correct them on the Sources tab.
insert into public.signal_source (kind, address, label, category) values
  ('page', 'https://www.ycombinator.com/apply', 'Y Combinator: apply', 'accelerator'),
  ('page', 'https://www.techstars.com/accelerators', 'Techstars: accelerators', 'accelerator'),
  ('page', 'https://speedrun.a16z.com/apply', 'a16z Speedrun: apply', 'accelerator'),
  ('page', 'https://www.alchemist.vc/pitch', 'Alchemist Accelerator: apply', 'accelerator'),
  ('page', 'https://www.eranyc.com/apply/', 'Entrepreneurs Roundtable Accelerator: apply', 'accelerator'),
  ('page', 'https://startupchile.org/en/apply/', 'Start-Up Chile: apply', 'accelerator'),
  ('page', 'https://www.antler.co/pitch', 'Antler: apply', 'accelerator'),
  ('page', 'https://www.gener8tor.com/investment-accelerators', 'gener8tor: investment accelerators', 'accelerator'),
  ('page', 'https://solve.mit.edu/challenges', 'MIT Solve: challenges', 'accelerator'),
  ('page', 'https://www.neh.gov/grants', 'National Endowment for the Humanities: grants', 'funder'),
  ('page', 'https://www.clevelandfoundation.org/grants', 'Cleveland Foundation: grants', 'funder'),
  ('page', 'https://kresge.org/grants-social-investments/current-funding-opportunities/', 'Kresge Foundation: current funding opportunities', 'funder')
on conflict (kind, address) do nothing;

notify pgrst, 'reload schema';
