-- 0062_voice_profile.sql
--
-- Auto-Draft, patch 4: the voice profile, its plumbing only (Auto-Draft build
-- spec, sections 3 and 10; Shane, 12 October 2026: "do not build your own
-- style guide or voice profile guide yet", to be written together at the end
-- of the build).
--
-- What this makes possible:
--   * One voice profile per client: how the client tends to build answers
--     (where stories sit against data, how bridges open and close, paragraph
--     shape, words they reach for). Voice and structure only, never facts.
--   * For Granted reads and writes it on the client's activity page. Nothing
--     writes it automatically yet.
--   * The sources it was written from are kept beside it (approved Standard
--     Answers, past grant applications, drafts marked Won), so the page can
--     say when the sources have changed since.
--
-- ADDITIVE. One new table. No existing row changes. For Granted only: clients
-- cannot read or write it. Reversible by dropping the table.

create table if not exists public.voice_profile (
  tenant_id     uuid primary key references public.tenant(id) on delete cascade,
  profile_text  text not null default '',
  sources       jsonb not null default '[]'::jsonb,
  built_at      timestamptz,
  edited_by     uuid references public.app_user(id) on delete set null,
  edited_at     timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.voice_profile enable row level security;

drop policy if exists voice_profile_admin on public.voice_profile;
create policy voice_profile_admin on public.voice_profile for all using (is_admin()) with check (is_admin());
