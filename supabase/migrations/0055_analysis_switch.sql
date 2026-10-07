-- 0055_analysis_switch.sql
--
-- Inven(s)tory Analysis, Phase D, patch 3: the switch-over (Build Decisions 29).
--
-- What this makes possible:
--   * A client can be switched to the analysis: from then on the analysis is
--     the source of that client's readiness, Card Library and search profile,
--     so the Analyze page and the Inven(s)tory page agree.
--   * What the client had before the switch (readiness and the search profile)
--     is kept here, so Switch back restores it exactly, without a paid re-read.
--   * RE-Assist's switch records the card review and Compare results it passed
--     (gate_snapshot). That is the proof every other client's switch rests on
--     (decision 29), and the date after which new clients start on the analysis.
--
-- ADDITIVE. Five new nullable columns on analysis_client_state (0050). No
-- existing row changes. Reversible by dropping the columns.

alter table public.analysis_client_state add column if not exists switched_at     timestamptz;
alter table public.analysis_client_state add column if not exists switched_by     uuid references public.app_user(id);
alter table public.analysis_client_state add column if not exists switched_off_at timestamptz;  -- set by Switch back; keeps a client off even if created after the proof
alter table public.analysis_client_state add column if not exists pre_switch      jsonb;        -- readiness and search profile as they were, for Switch back
alter table public.analysis_client_state add column if not exists gate_snapshot   jsonb;        -- the gate results this switch passed
