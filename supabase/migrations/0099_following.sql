-- 0099: Following (patch 66, 18 Nov 2026).
--
-- Shane, 18 Nov 2026: a client should be able to follow a funder from its
-- dossier, and keep one list of the funders, grants, RFPs and accelerators it
-- is tracking, with updates it can turn on and off per item. Decided the same
-- day: the Following list is SHARED across a client's team; email opt-in (a
-- later patch) is each person's own.
--
-- The list is the existing saved_item table (patch 26), which was built to
-- hold funders as well as grants. Two additive changes:
--   1. 'rfp' joins the kinds, for RFP Engine results For Granted adds to a
--      client's list.
--   2. `updates`: whether this item may raise notices. On by default; the
--      team's shared switch per item.
-- No existing row changes. Paste BEFORE the deploy.

alter table public.saved_item drop constraint if exists saved_item_kind_check;
alter table public.saved_item add constraint saved_item_kind_check check (kind in ('grant','funder','rfp'));

alter table public.saved_item add column if not exists updates boolean not null default true;

comment on column public.saved_item.updates is
  'Whether this followed item may raise notices (patch 66). Shared by the client''s team; email opt-in is per person and lives elsewhere.';

notify pgrst, 'reload schema';
