-- Website intake (14 October 2026): the forgranted.com Interest Cart and the
-- anonymous interaction log behind it.
--
-- What this makes possible:
--   * site_event: one row per anonymous interaction on forgranted.com (a card
--     picked up, added to or removed from the Interest Cart, the cart form
--     started, Storyboard demo milestones). Keyed by a random per-tab visit id.
--     No names, emails, cookies or IP addresses are stored here.
--   * site_interest: one row per Interest Cart a visitor sends: their name,
--     organization, email and the cards they chose.
--
-- Neither table belongs to a client, so neither carries tenant_id. Both have
-- row-level security switched on with NO policies: only the portal's
-- service-role client (the /api/site routes) can read or write them.
--
-- ADDITIVE. Two new tables; nothing existing is touched.
-- Reversible: drop table public.site_event; drop table public.site_interest;

create table if not exists public.site_event (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visit_id text not null check (char_length(visit_id) between 4 and 64),
  name text not null check (char_length(name) between 1 and 40),
  props jsonb not null default '{}'::jsonb,
  path text check (char_length(path) <= 200),
  country text check (char_length(country) <= 4)
);
create index if not exists site_event_created_idx on public.site_event (created_at desc);
create index if not exists site_event_name_idx on public.site_event (name, created_at desc);
alter table public.site_event enable row level security;

create table if not exists public.site_interest (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  visit_id text check (char_length(visit_id) <= 64),
  name text not null check (char_length(name) between 1 and 120),
  org text not null check (char_length(org) between 1 and 160),
  email text not null check (char_length(email) between 3 and 200),
  cards text[] not null default '{}',
  status text not null default 'new' check (status in ('new','contacted','closed'))
);
create index if not exists site_interest_created_idx on public.site_interest (created_at desc);
alter table public.site_interest enable row level security;
