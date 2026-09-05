-- The people who actually read the letter.
--
-- The base dataset carries a funder's 990 officers, which are governance, not
-- the people who run the grantmaking. For The George Gund Foundation the
-- dataset lists nine names: the president and eight trustees. Program officers
-- and grants managers appear on a funder's own site and are absent from the
-- dataset entirely. So this is new information, not a correction to existing
-- information, and it gets its own table.
--
-- Checked directly, September 2026: of fifteen funder websites read, only two
-- named any program staff at all. The rest offer a shared inbox. This table
-- will fill from conversations far more than from crawling.
--
-- A table rather than a column, because there are usually several per funder,
-- they change often, and provenance differs per person: one may come from a
-- 990-PF filing, another from the funder's team page, a third from a phone
-- call. The third is the most valuable and the least reproducible.
--
-- NOT tenant-scoped, and deliberately absent from TENANT_SCOPED in
-- scripts/check-tenant-scoping.mjs. Like ledger_overlay this is For Granted IP
-- shared across engagements, not a client's data.
--
-- NOT client-visible. Admin-only by RLS, and no client surface reads it. A
-- client emailing a program officer cold, without the framing For Granted would
-- give it, spends a relationship that cannot be bought back.

create table if not exists public.funder_contact (
  id            uuid primary key default gen_random_uuid(),
  -- Digits only, matching normalizeEin(), so a contact joins the funder record
  -- however the EIN was spelled where it came from.
  ein           text not null,
  name          text not null,
  title         text,
  -- What this person is FOR, which decides whether to write to them at all.
  role          text not null default 'unknown'
                  check (role in ('program_officer','grants_manager','executive',
                                  'assistant','general_inquiry','trustee','unknown')),
  -- Which portfolio they hold: "Public Education", "Climate Justice". The
  -- reason a foundation with five program directors needs five rows.
  portfolio     text,
  email         text,
  phone         text,

  -- Where this came from, which is how much to trust it.
  --   filing_990pf  Part XV intake contact. Institutional, 12-24 months stale.
  --   funder_site   their own team page. Current, specific, needs re-checking.
  --   conversation  someone told us. The best of the three and the only one
  --                 nobody else has.
  source_type   text not null default 'funder_site'
                  check (source_type in ('filing_990pf','funder_site','conversation','other')),
  source_url    text,
  note          text,                      -- For Granted internal, never rendered to a client

  -- People leave. A confidently displayed contact who left eighteen months ago
  -- is worse than an empty cell, because somebody acts on it.
  status        text not null default 'active'
                  check (status in ('active','departed','unknown')),
  last_verified_at timestamptz not null default now(),

  added_by      uuid references public.app_user(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.funder_contact is
  'Program officers and grants managers per funder. For Granted IP, admin-only, never shown to clients. Not the 990 officers, which are governance.';
comment on column public.funder_contact.last_verified_at is
  'When a person last confirmed this contact still holds the role. Staleness is displayed, not hidden: people move.';

create index if not exists funder_contact_ein_idx on public.funder_contact (ein, status);

-- One row per person per funder. Re-recording the same person updates them
-- rather than stacking duplicates every time someone re-checks a team page.
create unique index if not exists funder_contact_unique_idx
  on public.funder_contact (ein, lower(name));

drop trigger if exists funder_contact_updated_at on public.funder_contact;
create trigger funder_contact_updated_at before update on public.funder_contact
  for each row execute function public.set_updated_at();

alter table public.funder_contact enable row level security;
drop policy if exists funder_contact_admin on public.funder_contact;
create policy funder_contact_admin on public.funder_contact
  for all using (is_admin()) with check (is_admin());
