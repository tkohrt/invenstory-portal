# Answer Library — Build Spec v2

Supersedes Part 2 of `Onboarding_and_Answer_Library_Spec.md` (2026-07-29). This version
folds in the five capabilities Shane specced on 2026-08-06: gamification, targeted
per-document sweep, question-pool expansion notifications, relevance rank-ordering, and
the navigation changes. Everything here is designed to reuse the existing portal
primitives — the artifact engine, RLS, RAG retrieval, ingestion pipeline, review queue,
Slack/Resend notifier, and the stats dashboard.

Status legend used throughout: **[now]** buildable today · **[gen]** needs Bedrock
generation (scaffolds with the extractive fallback, lights up when the quota clears).

> **Execution status (2026-08-06): DEFERRED.** Spec approved; backend build saved for
> later. Only the A0 nav/UI shell has shipped.
>
> **Locked decision — Shane, 2026-08-06:** answers live in a **dedicated `answer`
> table** (not on the generic artifact-card engine), because they carry robustness,
> source, and per-answer sweep state beyond what the card payload holds cleanly. See §2.

---

## 0. What shipped already (2026-08-06)

Two low-risk UI changes are live in production ahead of the backend build:

- Left-nav "Library" renamed to **"[Client]'s Inven(s)tory"** (uses the tenant name;
  for admins it follows the currently-selected client).
- New **"Answer Library"** nav tab and route (`/answer-library`) with an intro section
  at the top explaining the purpose: answer the common grant questions once, drawing on
  your Inven(s)tory, so every future application starts from a high-quality draft. The
  page currently shows the three-step explainer, the core question categories, and a
  "coming soon — your personalized set is being prepared" state. The interactive
  question cards, meters, and controls below are what this spec builds into that shell.

---

## 1. Concept recap

80–90% of grant (and investor) questions are variations of the same ~10–15 asks. The
Answer Library pre-answers those standard questions per client from their own corpus —
cited, review-gated, short and long form, each with a completeness flag. It turns grant
writing into assembly. The question bank is the SAME asset as the Layer III
"common-app-style interview": build the bank once; it powers both capture and assembly.

New in v2, the library becomes a living, gamified profile that (a) shows the client how
complete and how human-verified their answers are, (b) reacts to every new document by
checking whether it changes an answer, (c) tells the client when For Granted adds new
questions and nudges them to complete them, and (d) orders the questions so each client
sees the ones they're most likely to be asked first.

---

## 2. Data model

Global, For Granted-owned (not tenant-scoped, read-only to clients):

- `grant_question` — id, slug, category, prompt_text, audience
  ('nonprofit' | 'startup' | 'both'), guidance, base_sort_order, active,
  created_at, published_at. Seeded with the starter bank; grows over time.
- `question_release` — id, released_at, question_ids[], note. One row each time For
  Granted publishes a batch of new questions. Drives the expansion notifications (§6).

Per-tenant (RLS: client sees own tenant, admin sees all):

- `answer` — id, tenant_id, question_id, short_answer (~50w), long_answer (~250w),
  completeness ('strong' | 'partial' | 'missing'), robustness_score (0–100, §4.1),
  source ('auto' | 'human'), status ('draft' | 'in_review' | 'published'),
  reviewed_by, reviewed_at, updated_at, stale (bool). **LOCKED (Shane, 2026-08-06):
  dedicated `answer` table**, not the generic artifact-card engine — chosen because
  answers carry robustness, source, and per-answer sweep state beyond what the card
  payload holds cleanly. It still routes through the existing review queue to publish.
- `answer_citation` — answer_id, document_id, chunk_id, snippet. The "sourced from" list.
- `answer_relevance` — tenant_id, question_id, relevance_score (0–1), computed_at.
  Cached ranking output (§7) so the list isn't re-scored on every page load.
- `answer_event` — tenant_id, question_id, kind
  ('auto_generated' | 'human_edited' | 'reviewed' | 'sweep_suggested' |
  'sweep_applied' | 'went_stale'), document_id (nullable), created_at. Audit + powers
  the "recently updated" feed and the auto-vs-human counts.
- `client_notification` — id, tenant_id, kind
  ('doc_uploaded' | 'question_release' | 'answer_updated' | 'review_published'),
  title, body, cta_href, read_at, created_at. Backs the in-portal Notifications tab (§6).

All per-tenant rows inherit existing RLS. `grant_question` / `question_release` are
readable by all authenticated users, writable only by the service client (admin CRUD).

---

## 3. Generation pipeline (per client) — [gen]

For each active question matching the client's audience: retrieve the client's most
relevant chunks (existing RLS-scoped RAG) → answer ONLY from those passages, short +
long form → classify completeness → score robustness (§4.1) → write citations →
land as `source='auto'`, `status='in_review'` → Slack the review queue → publish on
admin approval. Bedrock-armed; extractive fallback while the quota is 0. A 'missing'
answer cites nothing (allowed); 'strong'/'partial' must cite ≥1 document.

---

## 4. Gamification

### 4.1 Robustness score (per answer, 0–100)
A blend, tuned later, of: completeness flag (missing=0, partial≈40, strong≈75 base),
citation count and diversity (more distinct source docs → higher), answer length vs.
target, and a verification bonus (human-reviewed answers get the top band). The score is
what the progress bars aggregate — it rewards not just "answered" but "answered well and
verified."

### 4.2 Profile completeness bar (per client)
Headline meter on the Answer Library page and mirrored on the Dashboard: average
robustness across the client's ranked, in-scope questions, shown as a percentage with a
label ("Your grant profile is 68% complete"). Uses the existing dashboard stat styling.

### 4.3 Auto vs. human-reviewed breakdown
A second, segmented bar: how many answers are still auto-generated only vs.
human-reviewed/edited. Copy frames human review as the goal ("14 answered · 6 verified by
you — verify the rest to make them submission-ready"). `answer.source` +
`answer_event(kind='reviewed'|'human_edited')` drive this; no AI needed. **[now]**

### 4.4 Nudges & streaks (light touch)
Per-question chips ("Draft ready — review", "Thin — add detail", "Not started"), a small
celebratory state when a category hits all-strong, and a single primary CTA that always
points at the highest-impact next action (lowest-robustness, highest-relevance question).
Avoid dark patterns — no fake urgency, no punishing decay; staleness (§5) is framed as
"we found something that could improve this," not a penalty.

---

## 5. Targeted document sweep on upload — [gen for scoring, now for wiring]

When a new document finishes ingesting (hook into the existing post-ingest step that
already fires the upload notification), run a **targeted** check rather than blanket
staleness:

1. For the new document's chunks, find which questions they're semantically close to
   (reuse `match_chunks` / hybrid retrieval, scoped to this tenant).
2. For each candidate question, compare the new passages against the current answer:
   does the document add a fact, metric, quote, or recency the answer lacks, or
   contradict it? (Bedrock judges "meaningfully changes"; extractive fallback flags
   high-similarity-to-question-but-not-yet-cited passages.)
3. For questions that clear the bar, mark that `answer.stale = true`, write an
   `answer_event(kind='sweep_suggested', document_id=...)`, and surface it: a
   "New material may improve this answer" chip on the question, an entry in the
   client's Notifications tab, and the doc-upload Slack/email already sent to For Granted
   now names which answers it may affect.
4. Regeneration is one click (admin, or client-initiated → review queue). On apply,
   `answer_event(kind='sweep_applied')` and the citation set updates.

Key difference from v1: v1 marked the whole set stale on any upload. v2 pinpoints the
specific answers a specific document touches, so the nudge is precise and credible.

---

## 6. Notifications

### 6.1 In-portal Notifications tab — [now]
New `/notifications` route + nav item with an unread badge (reuse the `badge-count`
style already on the admin reviews item). Lists `client_notification` rows newest-first,
each with title, body, timestamp, read/unread, and a CTA deep-link (to the affected
question, the new-questions filter, or a published review). Mark-read on open;
mark-all-read control.

### 6.2 Question-pool expansion flow — [now to send, gen optional for copy]
When For Granted publishes a new batch (creates a `question_release`):
- Fan out a `client_notification(kind='question_release')` to every tenant whose
  audience matches at least one new question.
- Send an email via the existing Resend path to each client's primary contact. Copy is
  incentive-framed: what's new, why it matters ("funders increasingly ask about X"), how
  many now apply to them, and a one-click CTA into the Answer Library filtered to the new
  questions. Optionally personalize per client with a one-line "based on your
  Inven(s)tory, N of these are highly relevant to you" (uses §7 scores).
- The new questions appear in each client's list flagged "New" and, per §7, sorted into
  their relevance order rather than dumped at the bottom.

### 6.3 Document-upload notifications (already built) — extend
The existing "client uploaded a document" email + Slack to info@forgranted.com stays;
§5 enriches it to name any answers the upload may improve.

---

## 7. Relevance rank-ordering — [gen light / now with fallback]

Each client should see the questions they're most likely to be asked, first. For every
in-scope question, compute a relevance score from that client's Inven(s)tory:

- Semantic: max/mean similarity between the question prompt (and its guidance/keywords)
  and the client's chunk embeddings — questions the corpus already speaks to score high.
- Signal boosts: org type match, presence of the document categories a question depends
  on (e.g. a "financial overview" question ranks higher once 990s/budget are present),
  and funder-pattern weight from For Granted IP (which questions this org profile tends
  to face).

Store in `answer_relevance` (recomputed on new documents and on question releases; a
nightly scheduled task can refresh in bulk). Sort the list by relevance desc, with
already-strong answers optionally sinking so attention goes where it's needed. Fallback
before Bedbrock/embeddings coverage is complete: order by `base_sort_order` within
audience, then by whether supporting document categories exist. **The default view is
"ranked for you"; the client can re-sort by category or by completeness.**

---

## 8. Client + admin UX

Client (`/answer-library`):
- Intro section (shipped) → completeness bar + auto/human bar (§4) → primary "next best
  question" CTA → question list, default sorted by relevance (§7), each card showing
  prompt, short & long answer, completeness chip, robustness, "New"/"May be improved by
  [doc]" flags, and citations. Inline edit + "mark reviewed" promotes `source` to
  'human' and routes through the gate.
- Notifications tab (§6.1) with unread badge.

Admin:
- `grant_question` CRUD + "publish release" action (creates `question_release`, triggers
  §6.2 fan-out).
- Per-client answer review in the existing queue (approve/edit/publish).
- Sweep suggestions visible per client; one-click regenerate.
- Portfolio roll-up on the admin dashboard: avg completeness across clients, % verified,
  outstanding sweep suggestions, response rate to the last question release.

---

## 9. Build sequence

- **A0 (shipped).** Nav rename + Answer Library tab + intro shell.
- **A1 [now].** `grant_question` + `question_release` tables, seed starter bank, admin CRUD.
- **A2 [now].** `answer` + citations + events tables; Answer Library list UI reading them;
  inline edit + "mark reviewed" (source→human) through the review gate.
- **A3 [gen].** Generation over the bank per client + completeness classification +
  robustness scoring (scaffold with extractive fallback now).
- **A4 [now].** Gamification: completeness bar, auto/human bar, per-question chips,
  next-best-action CTA; mirror headline meter on Dashboard.
- **A5 [now→gen].** `client_notification` + `/notifications` tab + unread badge; wire
  the doc-upload notifier in. Question-release fan-out (email + in-portal) — sending is
  [now]; optional relevance-personalized copy is [gen].
- **A6 [gen→now fallback].** Relevance rank-ordering: `answer_relevance` compute +
  default "ranked for you" sort + client re-sort controls + nightly refresh task.
- **A7 [now].** Targeted document sweep on upload: post-ingest hook → candidate
  questions → change judgement (gen; extractive fallback) → stale flag + events +
  notifications + one-click regenerate.
- **A8 [now].** Compounding loop with Grant Drafts: a [BRACKET] answered in a draft that
  maps to a standard question refreshes that answer; a new draft auto-fills brackets the
  library already answers strongly ("we don't ask twice").

Natural order: A1 → A2 → A4 → A5 → A6 → A7 → A8, with A3 lighting up whenever the Bedrock
quota clears (A2/A4/A5/A6-fallback/A7-wiring don't wait on it).

---

## 10. Dependencies & isolation notes

- Reuses: RAG retrieval + `match_chunks`, artifact/review queue, Resend + Slack notifier,
  ingestion post-processing hook, RLS helpers, stats dashboard styling, probe suite.
- New global surface: `grant_question`, `question_release` (read-only to clients) — the
  only cross-tenant tables; everything else is tenant-scoped and inherits RLS.
- De-identification holds: the QUESTION BANK and funder-side patterns are shared For
  Granted IP; a client's answers, citations, relevance scores, and competitive data are
  never shared across tenants.
- Bedrock: only A3 (generation), A5's optional personalized copy, A6's semantic scoring,
  and A7's change-judgement need it; each has a defined extractive/heuristic fallback so
  the feature is usable before the quota clears and improves silently after.
