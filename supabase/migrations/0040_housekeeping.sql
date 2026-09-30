-- 0040_housekeeping.sql
--
-- Two small corrections found while building the Card Library. Applied through
-- the Supabase connector on 30 September 2026 at Shane's instruction.
--
-- 1. RECORD a column that already exists. search_profile_doc.content_hash is
--    read and written by lib/server/search-profile-extract.ts and is present in
--    the live database (text, nullable), but no migration created it: it was
--    added outside the repo. This records it so a fresh database built from
--    supabase/migrations matches production. A no-op where it already exists.
--
-- 2. STOP signed-out callers running the two tenancy helpers through the API.
--    is_admin() and current_tenant_id() are SECURITY DEFINER and were callable
--    by the anon role at /rest/v1/rpc/*. They derive identity from auth.uid(),
--    so a signed-out caller only ever got false or null back, but there is no
--    reason for the door to be open. Postgres grants EXECUTE to PUBLIC by
--    default, so PUBLIC is revoked too, or anon would keep it through PUBLIC.
--
--    Signed-in users KEEP execute, deliberately. Every RLS policy in the portal
--    calls these functions as the querying user; revoking from authenticated
--    would make every signed-in read fail with "permission denied". The
--    Supabase advisor will therefore keep one warning for authenticated
--    callers, and that warning is expected.
--
--    Safe for the app: nothing in the portal queries the database while signed
--    out (proxy.ts only calls auth.getUser; the service role keeps execute).
--
-- ADDITIVE / PERMISSIONS ONLY. No row is read, changed or deleted.

alter table public.search_profile_doc add column if not exists content_hash text;

comment on column public.search_profile_doc.content_hash is
  '<length>:<hash> of the text this row was read from, or ''boilerplate'' / ''empty'' for a deliberate skip. A document whose current text no longer matches is re-read.';

revoke execute on function public.is_admin()          from public, anon;
revoke execute on function public.current_tenant_id() from public, anon;
grant  execute on function public.is_admin()          to authenticated, service_role;
grant  execute on function public.current_tenant_id() to authenticated, service_role;
