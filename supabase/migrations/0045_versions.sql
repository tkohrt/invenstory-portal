-- 0045_versions.sql
--
-- Storyboarding Tool, Phase 3.2: versions and statuses.
--
-- What this makes possible:
--   * A draft can be marked Completed (finished, still editable) between
--     Drafting and Submitted. Submitted locks the draft.
--   * A draft remembers its stage (Arrange, Weave, Polish), so a version can be
--     saved the moment it moves on: "Before Weave", "Before Polish".
--   * Versions (draft_snapshot rows) gain the reasons the Storyboard saves them
--     for (a stage change, Completed, an autosave, before a restore), an
--     optional name, the stage it was taken in, and a fingerprint so an
--     autosave is skipped when nothing has changed.
--
-- NO EXISTING ROW IS CHANGED. Two check constraints are replaced by wider ones
-- (every value allowed before is still allowed), and the rest is new columns
-- with defaults or empty. The two "drop constraint" lines below remove a rule
-- and immediately add a looser one in its place; they delete no data.

-- ---------------------------------------------------------------------------
-- 1. Statuses: Completed joins Drafting, With client, Submitted, Won, Lost.
-- ---------------------------------------------------------------------------
alter table public.grant_draft drop constraint if exists grant_draft_status_check;
alter table public.grant_draft add constraint grant_draft_status_check
  check (status in ('drafting','client_review','completed','submitted','won','lost'));

alter table public.grant_draft
  add column if not exists completed_at timestamptz,
  add column if not exists stage text not null default 'arrange'
    check (stage in ('arrange','weave','polish'));

-- ---------------------------------------------------------------------------
-- 2. Versions.
-- ---------------------------------------------------------------------------
alter table public.draft_snapshot drop constraint if exists draft_snapshot_reason_check;
alter table public.draft_snapshot add constraint draft_snapshot_reason_check
  check (reason in ('submitted','manual','completed','stage','autosave','restore'));

alter table public.draft_snapshot
  add column if not exists name         text,
  add column if not exists stage        text check (stage in ('arrange','weave','polish')),
  add column if not exists content_hash text;

create index if not exists draft_snapshot_draft_taken_idx on public.draft_snapshot (draft_id, taken_at desc);
