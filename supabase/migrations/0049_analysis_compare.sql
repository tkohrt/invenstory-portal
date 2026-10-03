-- 0049_analysis_compare.sql
--
-- Inven(s)tory Analysis, Phase B: the comparison gate.
--
-- What this makes possible:
--   * For each client, readiness worked out from the one read is set beside
--     the readiness the portal shows today, item by item, on the Analysis
--     (trial) page. Every item where the two disagree is judged by a person:
--     the new read is right, the current read is right, either is acceptable,
--     or neither. The spec's rule for switching a client over is that every
--     disagreement has been looked at.
--   * Each judgement records the two states it was given for, so a re-read
--     that changes either side puts the item back in front of a person.
--   * The same for Funding Eligibility suggestions that differ from what the
--     client's profile holds (area 'eligibility').
--
-- ADDITIVE. One new table, admin-only under RLS like the other analysis
-- tables. No existing row or column changes. Reversible by dropping it.

create table if not exists public.analysis_verdict (
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  area         text not null check (area in ('readiness','eligibility')),
  item_key     text not null,           -- checklist key, or eligibility field
  verdict      text not null check (verdict in ('new_correct','old_correct','both_acceptable','neither')),
  old_state    text not null,           -- what the current read said when judged
  new_state    text not null,           -- what the new read said when judged
  note         text,
  reviewed_by  uuid references public.app_user(id),
  reviewed_at  timestamptz not null default now(),
  primary key (tenant_id, area, item_key)
);

alter table public.analysis_verdict enable row level security;
create policy analysis_verdict_admin on public.analysis_verdict for all using (is_admin()) with check (is_admin());
