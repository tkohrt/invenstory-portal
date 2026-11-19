-- 0100 Trust tiers (patch 67, 19 November 2026).
--
-- Review at the point of use. Until now every lead a source produced waited
-- for a person before any client could see it. From here:
--   * signal_source.trust says whose words a source carries. 'first_party' is
--     the funder's or programme's own page or account, or a federal agency.
--     'review' is everything else (news, aggregators, newsletters).
--   * ledger_overlay.published_at marks an opportunity that a first-party
--     source produced and that clients may see, labelled "Not yet reviewed by
--     For Granted", while it still waits in the queue. Approving or rejecting
--     it works exactly as before. Nothing unreviewed joins matching or a fit
--     report: those still read approved rows only.
--   * ledger_overlay.signal_source_id records which source an entry came from.
--
-- Safe to run more than once.

alter table public.signal_source
  add column if not exists trust text not null default 'review';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'signal_source_trust_check') then
    alter table public.signal_source add constraint signal_source_trust_check check (trust in ('first_party','review'));
  end if;
end $$;

alter table public.ledger_overlay
  add column if not exists published_at timestamptz,
  add column if not exists signal_source_id uuid references public.signal_source(id) on delete set null;
create index if not exists ledger_overlay_published_idx on public.ledger_overlay (published_at) where published_at is not null;
create index if not exists ledger_overlay_signal_source_idx on public.ledger_overlay (signal_source_id) where signal_source_id is not null;

-- Sector news, aggregators and membership bodies among the Bluesky follows:
-- they report on other people's money, so what they yield waits for review.
-- They were filed as 'funder' because every follow was; that is corrected too.
update public.signal_source set category = 'aggregator', trust = 'review'
 where kind = 'bluesky' and address in (
   'insidephilanthropy.com','chronphilanthropy.bsky.social','ssir.org','candiddotorg.bsky.social',
   'councilfoundations.bsky.social','devex.com','gihealth.bsky.social','ncrpcommunity.bsky.social',
   'nonprofitaf.bsky.social','techsoup.bsky.social','bridgespangroup.bsky.social');

-- Every other source on file today is a funder's, accelerator's or federal
-- agency's own page or account (checked by hand on 19 November 2026).
-- Newsletter senders never publish without review.
update public.signal_source set trust = 'first_party'
 where kind in ('page','bluesky') and category in ('funder','accelerator') and trust = 'review'
   and created_at < '2026-11-20';

-- Which source each existing signals entry came from. The run reads one
-- signal at a time, so an entry belongs to the last signal filed before it
-- under the same list (checked against the live data: 56 of 56 entries, each
-- signal's count matching its own tally).
update public.ledger_overlay o
   set signal_source_id = (
     select s.source_id from public.signal s
      where s.curated_list_id = o.curated_list_id and s.status = 'filed' and s.seen_at <= o.created_at
      order by s.seen_at desc limit 1)
 where o.signal_source_id is null and o.provenance = 'curated_list'
   and o.curated_list_id in (select distinct curated_list_id from public.signal where curated_list_id is not null);

-- The backlog: opportunities already waiting that a first-party source
-- produced go live with the label. Funder records and everything from a
-- 'review' source stay in the queue.
update public.ledger_overlay o
   set published_at = now()
  from public.signal_source s
 where s.id = o.signal_source_id and s.trust = 'first_party' and s.kind <> 'email'
   and o.kind = 'grant' and o.status in ('proposed','in_review') and o.published_at is null
   and o.source_url ~* '^https?://';

notify pgrst, 'reload schema';
