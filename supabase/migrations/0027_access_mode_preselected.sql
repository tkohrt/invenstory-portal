-- A sixth access mode, because the vocabulary was claiming more than the
-- evidence supports.
--
-- `invitation_only` promises a route in: cultivate a relationship, find an
-- introduction from an existing grantee. Most of the evidence we can actually
-- get does not support that promise. Form 990-PF's check box, and the phrase
-- that turns up most often in funder prose, say only that the foundation "does
-- not accept unsolicited requests" and gives to organizations it has already
-- chosen. That is equally true of:
--
--   a foundation that quietly cultivates new grantees      (invitation works)
--   one that exists to fund a single hospital or university (nothing works)
--   a family giving to its own alma maters                  (nothing works)
--   one winding down and honouring prior commitments        (temporary)
--   a return where the preparer checked the easy box        (may be wrong)
--
-- Telling someone to go find a warm introduction to a captive foundation wastes
-- their week in a new way. So `preselected_only` says exactly what the evidence
-- supports and no more, and a person can refine it to invitation_only or closed
-- once they know which of the five it is.

alter table public.matched_funder drop constraint if exists matched_funder_access_mode_check;
alter table public.matched_funder add constraint matched_funder_access_mode_check
  check (access_mode in ('open','invitation_only','preselected_only','rfp_cycle',
                         'donor_advised','closed','unknown'));
