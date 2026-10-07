-- 0053_card_refusal.sql
--
-- Inven(s)tory Analysis, Phase D, patch 1: remembered refusals
-- (Build Decisions 19 and 31).
--
-- What this makes possible:
--   * A card For Granted marks Not supported in the analysis review, or retires
--     as Inaccurate in the Card Library, has its quote remembered for that
--     client. Every later read is filtered through what is remembered, so the
--     card cannot come back after a re-read however the reader words it.
--   * An admin can lift a refusal on the Analysis page, letting the quote
--     through again. Lifting is recorded, not deleted.
--
-- Backfill: every review already marked Not supported (RE-Assist's 9 on
-- 6 October 2026), and the evidence quotes of any card already retired as
-- Inaccurate.
--
-- ADDITIVE. One new table, admin-only under RLS like the other analysis
-- tables. No existing row or column changes. Reversible by dropping it.

create table if not exists public.card_refusal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  source       text not null check (source in ('review','library')),
  source_ref   text not null,            -- the review's fingerprint, or the story_card id
  document_id  uuid references public.document(id) on delete set null,
  kind         text not null,
  statement    text not null,
  quote        text not null,            -- the quote as it was judged; matched in code (lib/refusal.ts)
  created_by   uuid references public.app_user(id),
  created_at   timestamptz not null default now(),
  lifted_by    uuid references public.app_user(id),
  lifted_at    timestamptz               -- set when an admin lets the quote through again
);
create index if not exists card_refusal_tenant on public.card_refusal (tenant_id, source, source_ref);

alter table public.card_refusal enable row level security;
create policy card_refusal_admin on public.card_refusal for all using (is_admin()) with check (is_admin());

-- Backfill: reviews already marked Not supported.
insert into public.card_refusal (tenant_id, source, source_ref, document_id, kind, statement, quote, created_by, created_at)
select r.tenant_id, 'review', r.fingerprint, r.document_id, r.kind, r.statement, r.quote, r.reviewed_by, r.reviewed_at
from public.analysis_review r
where r.verdict = 'unsupported'
  and not exists (select 1 from public.card_refusal x
                  where x.tenant_id = r.tenant_id and x.source = 'review' and x.source_ref = r.fingerprint);

-- Backfill: cards already retired as Inaccurate, one row per piece of evidence.
insert into public.card_refusal (tenant_id, source, source_ref, document_id, kind, statement, quote, created_at)
select c.tenant_id, 'library', c.id::text, e.document_id, c.kind, c.statement, e.quote, c.updated_at
from public.story_card c
join public.story_card_evidence e on e.card_id = c.id and e.tenant_id = c.tenant_id
where c.status = 'retired' and c.retired_reason = 'inaccurate'
  and not exists (select 1 from public.card_refusal x
                  where x.tenant_id = c.tenant_id and x.source = 'library' and x.source_ref = c.id::text);
