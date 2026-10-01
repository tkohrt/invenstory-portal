-- 0044_ui_prefs.sql
--
-- Storyboarding Tool, Phase 3.2: a person's small interface choices.
--
-- What this makes possible: "Don't ask me again" on the "Remove this card from
-- your answer?" message is remembered on the person's account, so it follows
-- them from laptop to phone, and can be switched back on from Account.
--
-- ADDITIVE. One column with a default; no existing value changes. Written only
-- by setUiPrefAction, which accepts known keys and true or false, for the
-- signed-in person's own row.
alter table public.app_user
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
