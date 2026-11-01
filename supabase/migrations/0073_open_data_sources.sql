-- Public international sources in Funder Matches (patch 4 of the 1 November
-- 2026 build). Additive: four nullable or defaulted columns, no existing row
-- changes meaning.
--
-- A client whose profile looks outside the US is now also searched against the
-- World Bank's procurement notices, the EU Funding & Tenders Portal and (with
-- an IATI key) international aid data. Their rows land in the same tables as
-- Ground Truth's and need three facts Ground Truth never had to carry:
--
--   eligible_grant.source      ledger | worldbank | eu_ft
--   eligible_grant.money_kind  grants | contracts | programs | investment
--   eligible_grant.currency    ISO code of award_ceiling when not US dollars
--                              (EU calls are in euros); NULL means dollars
--   matched_funder.source      ledger | iati
--
-- Rows written before this read as Ground Truth grants in dollars, which is
-- what they are. Apply BEFORE deploying patch 4: the match run writes these.

alter table public.eligible_grant add column if not exists source text not null default 'ledger';
alter table public.eligible_grant add column if not exists money_kind text not null default 'grants';
alter table public.eligible_grant add column if not exists currency text;
alter table public.matched_funder add column if not exists source text not null default 'ledger';

comment on column public.eligible_grant.source is 'Where the opportunity came from: ledger (Ground Truth), worldbank, eu_ft. Patch 4.';
comment on column public.eligible_grant.money_kind is 'grants, contracts, programs or investment. Patch 4.';
comment on column public.eligible_grant.currency is 'ISO currency of award_ceiling when not USD; NULL means USD. Patch 4.';
comment on column public.matched_funder.source is 'Where the funder came from: ledger (Ground Truth) or iati. Patch 4.';
