-- 990 phase two (patch 45): the grant lists out of foundation filings.
--
-- Part XV of a private foundation's 990-PF lists every grant it paid that
-- year: recipient, amount, purpose. Ingested per funder, on demand, so the
-- corpus grows exactly as fast as For Granted's actual funder universe. Each
-- ingest replaces that funder-year wholesale (idempotent re-pulls), and the
-- derived intelligence — above all the NEW-GRANTEE RATE, the best "can an
-- outsider get in" signal a filing can give — lands on the shared funder
-- profile with import_990 provenance.

create table if not exists public.funder_grant (
  id              uuid primary key default gen_random_uuid(),
  ein             text not null,
  tax_year        int not null,
  recipient       text not null,
  -- lowercased, squished, suffix-trimmed; what the year-over-year rate compares
  recipient_norm  text not null,
  amount          bigint,
  purpose         text,
  recipient_state text,
  created_at      timestamptz not null default now()
);

create index if not exists funder_grant_ein_idx on public.funder_grant (ein, tax_year desc);

alter table public.funder_grant enable row level security;
create policy funder_grant_admin_select on public.funder_grant
  for select using (is_admin());
create policy funder_grant_admin_write on public.funder_grant
  for all using (is_admin()) with check (is_admin());
