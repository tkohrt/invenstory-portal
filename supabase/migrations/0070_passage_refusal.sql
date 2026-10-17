-- 0070 Document Reader, Phase 1: "This passage does not support the card".
--
-- ADDITIVE. card_refusal gains one allowed source, 'passage', and one nullable
-- column, note. The source rule is replaced by one that allows everything it
-- allowed before plus 'passage', so no existing row is touched or could fail
-- it. Reversible: drop the column, and put the old rule back once no 'passage'
-- row remains.
--
-- A 'passage' refusal belongs to ONE card (source_ref = the card's id): that
-- quote no longer supports that card, and the merge does not attach it to that
-- card again. Unlike 'review' and 'library' refusals it does not stop the quote
-- feeding other cards. note is the optional "Why" from the reader's dialog.

alter table public.card_refusal drop constraint if exists card_refusal_source_check;
alter table public.card_refusal add constraint card_refusal_source_check
  check (source in ('review', 'library', 'passage'));

alter table public.card_refusal add column if not exists note text;
