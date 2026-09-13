-- Who is talking in a transcript.
--
-- A meeting has several people in it and the reader never sees which one is
-- speaking, so every first-person claim defaults to the client. On RE-Assist
-- that produced "mentored and advised hundreds and hundreds of companies" as
-- the client's own EVIDENCE, from a call where somebody else said "I've
-- mentored and advised hundreds and hundreds of companies" about their own
-- career. It reached a live search query as a credential they do not have.
-- Across three calls, 184 of 192 extracted facts were tagged as the
-- organization, which is implausible for meetings involving three firms.
--
-- WHY THE OBVIOUS FIX DOES NOT WORK. The plan was to read the speaker labels.
-- Two of RE-Assist's three transcripts label their speakers "Speaker 1",
-- "Speaker 2", "Speaker 3" and never name anybody, so the labels alone map to
-- nobody. Who they are has to be inferred from what they say: the one being
-- congratulated on their startup is not the one doing the congratulating.
--
-- So the roster is worked out once per document by reading its opening, and
-- kept here rather than recomputed per window or per run. It belongs on
-- `document` rather than on the Search Profile's own table because the
-- readiness engine reads the same transcripts and has the same problem; this
-- makes the answer available to it without deciding anything for it today.
--
-- Shape:
--   { "chars": 57267,
--     "speakers": [
--       { "label": "Speaker 2", "is_client": true, "name": "Ashley",
--         "evidence": "we built the prototype during COVID" },
--       { "label": "Speaker 1", "is_client": false, "name": null,
--         "evidence": "congratulations on moving forward with your startup" }
--     ] }
--
-- `is_client` is deliberately three-valued: true, false, or absent when there
-- is no evidence either way. Absent means the old behaviour applies, so this
-- can only ever remove a claim that was not the client's, never add one.

alter table public.document
  add column if not exists speaker_roster jsonb;

comment on column public.document.speaker_roster is
  'Who speaks in this transcript and which of them belong to the client, inferred once from the document opening. Absent is_client means unknown, which leaves attribution as it was.';
