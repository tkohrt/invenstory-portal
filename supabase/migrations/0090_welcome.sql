-- The welcome screen (patch 43): a note and an optional video Shane and Tyler
-- can pre-set per client, shown once on that client's first sign-in. Blank
-- means the default welcome; nothing else changes.
alter table public.tenant
  add column if not exists welcome_note text,
  add column if not exists welcome_video_url text;
