-- Access mode: can this funder actually be approached?
--
-- The base dataset has no field for it. A funder shortlist where an unknown
-- fraction of rows accept no unsolicited requests is not a shortlist, it is a
-- research backlog — and the way that failure shows up is a client spending a
-- week on a proposal nobody was ever going to read.
--
-- Three columns rather than one, because the distinction between what someone
-- VERIFIED and what we GUESSED is the whole point of Ground Truth:
--   access_mode      open | invitation_only | rfp_cycle | donor_advised
--                    | closed | unknown
--   access_note      the evidence — a quoted line for a verified answer, the
--                    dataset's own caveat for an inferred one
--   access_verified  true only when a person recorded it against the funder's
--                    own materials. An inference from a caveat or a
--                    donor_advised_fund_sponsor classification is worth showing
--                    and must never be shown as a fact.
--
-- `unknown` is the default on purpose. Defaulting to `open` would be the one
-- wrong answer that actively costs someone a week.

alter table public.matched_funder add column if not exists access_mode text not null default 'unknown';
alter table public.matched_funder add column if not exists access_note text;
alter table public.matched_funder add column if not exists access_verified boolean not null default false;

alter table public.matched_funder drop constraint if exists matched_funder_access_mode_check;
alter table public.matched_funder add constraint matched_funder_access_mode_check
  check (access_mode in ('open','invitation_only','rfp_cycle','donor_advised','closed','unknown'));

comment on column public.matched_funder.access_mode is
  'How this funder takes requests. Sourced from Ground Truth when recorded, else inferred from the caveat/funder type, else unknown.';
comment on column public.matched_funder.access_verified is
  'True only when a person recorded this against the funder''s own materials. False means inferred — never present it as established.';
