-- The demo wipe needs two keys (red-team review H1, 9 November 2026).
--
-- Until now the only thing marking a tenant as a demo was the DEMO_TENANT_IDS
-- environment variable in Vercel: one mistyped UUID there and a real client's
-- account would be irreversibly wiped on their next sign-in. This column is
-- the second key: resetDemoTenant now refuses to wipe any tenant whose row
-- does not ALSO say is_demo = true, so the env var alone can never select a
-- victim. Additive and safe: every existing tenant defaults to false.
--
-- AFTER APPLYING, mark the real demo tenant(s) by hand, for example:
--   update tenant set is_demo = true where id = '<the demo tenant uuid>';
-- (the same UUIDs that DEMO_TENANT_IDS names). Until that update runs, demo
-- resets are refused and logged, which fails safe.

alter table tenant add column if not exists is_demo boolean not null default false;

comment on column tenant.is_demo is
  'Second key for the demo wipe: resetDemoTenant refuses any tenant where this is false, even when DEMO_TENANT_IDS names it. Red-team H1, 9 Nov 2026.';
