-- 0102 Source scorecards (patch 69, 19 November 2026).
--
-- A first-party source publishes to clients before anyone reviews it. These
-- columns are the safety net: when For Granted rejects enough of what such a
-- source produced, the source goes back to waiting for review on its own.
--   * trust_set_at: when a person last chose the source's tier. Only
--     decisions made after it count, so a source a person re-promotes starts
--     with a clean record.
--   * demoted_at, demoted_note: set when the scorecard moved it to review,
--     with the reason in words; cleared when a person sets the tier again.
--
-- Additive, and safe to run more than once.

alter table public.signal_source
  add column if not exists trust_set_at timestamptz,
  add column if not exists demoted_at timestamptz,
  add column if not exists demoted_note text;

notify pgrst, 'reload schema';
