-- International eligibility (patch 1 of the 1 November 2026 build).
--
-- Funding Eligibility could only say where an organization is with a US state.
-- A consultancy registered in Kenya showed a critical "add your primary state"
-- gap the moment it signed in, and nothing could say it works across East
-- Africa. Four additive columns; no existing value changes.
--
--   country_code      where it is registered, ISO 3166 alpha-2. NULL on every
--                     profile saved before this, which were all US, and the
--                     code reads NULL as the United States (homeCountry in
--                     lib/eligibility-fields.ts), so nothing needs backfilling.
--   countries_served  countries it works in, ISO alpha-2. US states served stay
--                     in service_area, as before.
--   regions_served    UN M49 sub-regions it works across (lib/countries.ts).
--   international     asked to see funding from outside the United States. The
--                     search also looks abroad, without being asked, for an
--                     organization registered or working outside the US.
--
-- Apply BEFORE deploying patch 1: the save writes these columns, and without
-- them every save of Funding Eligibility is refused (and now says so).

alter table public.eligibility_profile add column if not exists country_code text;
alter table public.eligibility_profile add column if not exists countries_served jsonb not null default '[]'::jsonb;
alter table public.eligibility_profile add column if not exists regions_served jsonb not null default '[]'::jsonb;
alter table public.eligibility_profile add column if not exists international boolean not null default false;

-- Two capital letters or nothing. The application checks the code against the
-- full list; this stops anything else reaching the column by another route.
alter table public.eligibility_profile drop constraint if exists eligibility_profile_country_code_check;
alter table public.eligibility_profile add constraint eligibility_profile_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

comment on column public.eligibility_profile.country_code is
  'Country of registration, ISO 3166 alpha-2. NULL means the United States (profiles saved before 0071).';
comment on column public.eligibility_profile.countries_served is
  'Countries the organization works in, ISO alpha-2. US states served are in service_area.';
comment on column public.eligibility_profile.regions_served is
  'UN M49 sub-regions the organization works across (keys in lib/countries.ts).';
comment on column public.eligibility_profile.international is
  'Asked to see funding from outside the United States (the search also looks abroad when the profile shows non-US work).';

-- RLS is unchanged: the existing eligibility_profile policies cover new columns.
