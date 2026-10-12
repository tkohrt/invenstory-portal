-- 0061_brain_tenant.sql
--
-- Auto-Draft, patch 3: the Brain (Auto-Draft build spec, sections 7 and 10;
-- 12 October 2026).
--
-- What this makes possible:
--   * One special tenant, marked as the Brain, that holds For Granted's own
--     writing and de-identified examples. It reuses upload, ingestion,
--     document types and the analysis like any client, but it is not a
--     client: it is left out of client lists, funder matching, the garden,
--     the allowance, readiness and the Readiness Audit, and only admins can
--     open it (it never has client users).
--   * At most one Brain, enforced by a unique index.
--   * The Brain itself, created here as "For Granted Brain" if none exists.
--
-- ADDITIVE. One new column on tenant, false for every existing client, so no
-- client changes. One new tenant row (the Brain). Clients cannot see the
-- Brain: the tenant table's existing policies show a client only its own
-- organisation. Reversible: delete the Brain row, then drop the index and
-- the column.

alter table public.tenant add column if not exists is_brain boolean not null default false;

create unique index if not exists tenant_one_brain on public.tenant (is_brain) where is_brain;

insert into public.tenant (name, is_brain)
select 'For Granted Brain', true
where not exists (select 1 from public.tenant where is_brain);
