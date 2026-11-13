-- The 990 importer (patch 42): the client's own EIN, stored once so the
-- import, the readiness prompt and future registry work all read one place.
alter table public.tenant
  add column if not exists ein text;
