-- 0097: investment terms on a matched opportunity (patch 62, 18 Nov 2026).
--
-- Shane, 18 Nov 2026: accelerators that put cash in for equity belong in the
-- portal under "Accelerators, prizes and competitions", with the equity terms
-- shown. Until now the only amount a match carried was award_ceiling, so
-- "$150,000 on a SAFE for 6%" would have read as a $150,000 award.
--
-- One nullable text column: the deal in the programme's own words, copied from
-- the reviewed Ground Truth entry (ledger_overlay.fields.investment_terms) by
-- each matching run. Additive; no existing row is changed. Paste BEFORE the
-- deploy: a matching run on the new code writes this column.

alter table public.eligible_grant
  add column if not exists terms text;

-- Tell the API layer about the new column at once, so the first matching run
-- after the deploy can write it.
notify pgrst, 'reload schema';
