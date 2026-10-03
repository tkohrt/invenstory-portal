# Inven(s)tory Portal — Agent Guide (CLAUDE.md)

Multi-tenant client portal for **For Granted** (grants-partnership firm; founders Tyler Kohrt & Shane Winnyk). Each client is a *tenant*; the portal holds their **Inven(s)tory** (a layered, searchable knowledge base of everything that makes them fundable) and derives readiness, eligibility, funder matching, Story Cards and grant drafting (the Storyboarding Tool) from it.

## Stack
- **Next.js (App Router, Turbopack), Next 16** on **Vercel** → https://portal.forgranted.com
- **Supabase**: Postgres + Row-Level Security, Storage (private `documents` bucket), pgvector
- **Embeddings**: Supabase edge function `gte-small` (384-dim) — `lib/server/embed.ts`
- **LLM**: Claude on Google Vertex or AWS Bedrock (`LLM_PROVIDER`), via `lib/server/llm.ts` `chatComplete({system,user,maxTokens,temperature})`
- Repo: `tkohrt/invenstory-portal` (GitHub). Deploys are triggered manually via the Vercel CLI.

## Deploy / build
- Build command: `npm run build` → runs `node scripts/check-tenant-scoping.mjs && next build`.
- Deploy: `npx vercel deploy --prod --token <VERCEL_TOKEN> --yes`.
- **GOTCHA:** run the deploy from a directory literally named `invenstory-portal`. The Vercel CLI infers the project from the folder name; deploying from any other folder name creates a *stray project* (e.g. it once made an `ip2` project aliased to a random `.vercel.app`). A correct prod deploy ends with `▲ Aliased https://portal.forgranted.com`.
- The build "Failed to collect page data … supabaseUrl is required" error is now fixed (see lazy `db`). If it recurs, a module is instantiating a Supabase client at import time — make it lazy.

## Multi-tenant isolation — READ THIS BEFORE TOUCHING DATA
- Every tenant-owned table carries `tenant_id`. **RLS** (`supabase/migrations/0002_rls.sql`) enforces isolation via `current_tenant_id()` / `is_admin()` (both derive identity from `auth.uid()`, never from client input).
- **Two DB clients:**
  - `userClient()` (`lib/server/supabase.ts`) — cookie-authed; runs under RLS. **Default for user-facing reads.**
  - `db` (`lib/server/db.ts`) — service role; **bypasses RLS.** Reserved for the ingestion worker, admin cross-tenant aggregates, and identity resolution. It is a **lazy proxy** — never instantiate a client at module top level.
- **RULE:** every `db.from("<tenant table>")` must filter by `tenant_id` (in a `.eq/.in/.match` or an insert/upsert payload) OR carry an inline `// tenant-safe: <reason>` comment.
- **Enforced by `scripts/check-tenant-scoping.mjs`**, which runs as part of `npm run build` and **fails the deploy** on any unscoped, unannotated service-role call. Keep its `TENANT_SCOPED` table list in sync with the schema.
- Admins view one client at a time via the `active_tenant` cookie; `switchTenantAction` verifies admin against the role table and audits the switch.
- Storage keys are `{tenant_id}/{document_id}/{version}`; storage RLS checks the first path segment. Files served via short-lived signed URLs.

## Migrations
- **The database sleeps when idle.** After a quiet spell every Supabase connector query that touches the database (`execute_sql`, `list_tables`, `list_migrations`, `apply_migration`) times out with "Connection terminated due to connection timeout", while `get_project` still reports ACTIVE_HEALTHY. It is not a network restriction or connection exhaustion. One ordinary REST request wakes it (about 10 seconds the first time): `curl "https://dafofmvbbggrmyfnjspg.supabase.co/rest/v1/grant_question?select=slug&limit=1" -H "apikey: <publishable key from get_publishable_keys>"`. Do that before concluding the connector is broken.
- **0039 and 0040 were applied through the Supabase connector** (`apply_migration`) on 30 Sept 2026 at Shane's explicit instruction in chat, and verified from it. That was a one-off approval, not a change to the rule below.
- Numbered SQL in `supabase/migrations/`. **Applied to Supabase out-of-band (dashboard / CLI by Tyler)** — the sandbox has no DB creds (Supabase service key + embed secret are *sensitive/write-only* in Vercel and cannot be pulled). So: an agent here **cannot run migrations or write to the DB directly**; ship migration SQL for a human to apply, and do DB-touching client ops through the deployed app or a read-only connector.

## The Readiness engine (how an Inven(s)tory is graded)
Primary engine = **document-level extraction** (`lib/server/doc-extract.ts`):
- Reads each document once (windowed for long transcripts), asks which checklist items it *substantively* supports, with a **verbatim quote** and a **subject** tag.
- **Grounded**: "covered" requires a real supporting quote; topic/domain proximity ≠ substance; data-requiring items need actual figures.
- **Subject quarantine**: each finding is `organization | competitor | third_party`. Code enforces that competitor facts only satisfy *Competitive landscape*, third-party facts only relationship items (partnerships, client_story); everything else requires `organization`. See `subjectAllowed()`.
- **Boilerplate skipped**: templates / unsigned / sample / draft docs (`isBoilerplate`).
- **"About the org itself"**: don't count a company describing its product's capabilities or its clients as evidence the org *has* that item.
- Output → `eligibility_gap.content_gaps` = `{ key: { state: covered|thin|missing, sources: [{id,title,quote}] } }`.
- Triggers: `runGapAnalysisAction` (client "Run Readiness Check" button) and `refreshAllReadinessAction` (admin "Refresh all client cards" on the Readiness Audit page); new uploads fold in via `mergeDocumentIntoCoverage` (additive; full recompute via the button).
- The retrieval-based `lib/server/gap-agent.ts` (`traceContentCoverage`) now powers the **admin Readiness Audit** (`/admin/readiness-audit`) — a diagnostic showing per-item query, retrieved chunks + similarity, verdict, quote, subject. Both audit paths export to Markdown/JSON.
- Checklist config: `lib/checklist.ts` (`CHECKLIST`, `RETRIEVAL_QUERY` = artifact descriptions, `BLURBS`, `TIER_WEIGHT`, `checklistFor(orgType)` — `for_profit`→startup branch else nonprofit).

## The Garden (plant) — tie-in
- `lib/server/garden.ts` `getGardenState`. **Size** is readiness+eligibility-weighted and ratcheted (never shrinks, via persisted `size_2/size_3` achievements). **Health "thriving"** requires freshness AND substance (Essentials covered / readiness ≥ bar) AND a complete eligibility profile — gated on having been analyzed. Tunables in `GARDEN_TUNING`.
- The plant lives in the **left sidebar** (`components/Shell.tsx`) linking to `/plant` (`components/GardenPanel.tsx`). Retargeted growth prompts (`garden.prompt`) deep-link to `/invenstory?item=<key>` which opens that Readiness item's detail modal.

## Ingestion
- `lib/server/ingest.ts` `processDocument`: download from storage → `extract(buffer, doc_kind)` → `chunkPages` → embed → insert `document_chunk` + `chunk_embedding` → status ready → best-effort `mergeDocumentIntoCoverage`.
- Supported kinds: pdf (unpdf), docx (mammoth), note/web (text), rtf, **xlsx/xls (SheetJS, per-sheet CSV)**. Audio transcription pending.

## Conventions
- **Transcript filenames** (local FG transcripts folder): `YYYY-MM-DD_<context-slug>_<kebab-title>.md` (e.g. `2026-08-18_for-granted_rezme-grants-strategy-call.md`). Client meetings use the `for-granted` slug with the counterpart in the title.
- **Feature visibility**: `lib/workspace.ts` `WORKSPACE_FEATURES` + `feature_visibility`. Eligibility defaults visible; the Readiness checklist is decoupled (always shown on `/invenstory`).
- Prefer prose UI copy; forest-green accent `#1f4d2e` for primary CTAs.
- **Only verified Story Cards go into a grant** (decided 2 October 2026; rule in `lib/card-gate.ts`, pure and tested). Two gates. Placing: drag, Add, Arrange for me and starting from a Standard Answer refuse an unverified card; the Storyboard opens the card's review instead (`components/CardReview.tsx`, the same review card the Card Library uses), and verifying or editing it places it. The finish line: Mark completed, Mark submitted, approving a Standard Answer and Copy answer are refused while any card in it is unverified, sensitive and undecided, or retired (server backstops in `setDraftStatusAction` and `approveStandardAnswerAction`). Editing a card verifies it (`writeCardEdit`). Undo and restoring a version may bring an unverified card back; the finish line still stops it leaving. The finish line also holds a card block placed at an older version of a card that has since been reworded (issue `reworded`): the writer uses the new wording (`refreshBlockWordingAction`) or keeps the old one on purpose (`keepWordingAction`, which turns it into the draft's own edit).

## Key files
- `lib/server/db.ts` (lazy service client) · `lib/server/supabase.ts` (userClient/RLS) · `lib/server/session.ts` (tenant resolution)
- `lib/server/doc-extract.ts` (primary readiness) · `lib/server/gap-agent.ts` (audit/legacy) · `lib/checklist.ts`
- `lib/server/garden.ts` · `components/Shell.tsx` · `components/ReadinessCard.tsx` · `components/ReadinessAuditView.tsx` · `components/GardenPanel.tsx`
- `lib/server/ingest.ts` · `scripts/check-tenant-scoping.mjs` · `supabase/migrations/`
- Story Card Drafter, Phase 2 (bringing in a funder's application, 0041): `lib/application-parse.ts` (pure: windows, merge, limit and verbatim checks, bank-match validation) · `lib/application-text.ts` (PDF/Word/HTML to text, URL safety) · `lib/server/application-parse.ts` (the chained read + match job) · `lib/server/application-actions.ts` (save, confirm, reopen; writes `question_observation`) · `app/api/drafts/ingest` · `app/api/jobs/parse-application` · `/drafts/new`. Card-mode drafts are admin-only by RLS; the funder's text lives on `grant_draft.source_text` and is never filed into the Inven(s)tory. Sample applications for testing: `tests/fixtures/applications.ts`.
- Story Card Drafter, Phase 3 (the drafting workspace, Arrange; 0042): `lib/story-card-rank.ts` (pure: spec section 8 ranking, every weight in `WEIGHTS`, `SLUG_ITEMS`) · `lib/section-answer.ts` (pure: assembling blocks into the answer, word/character counts, Tidy's permutation check) · `lib/server/workspace.ts` (reads; a card block's words come from `story_card_version` at the version placed unless edited) · `lib/server/workspace-actions.ts` (every write; logs `card_event`) · `components/DraftWorkspace.tsx` (`@dnd-kit` drag plus Add and arrow buttons). A confirmed card-mode draft opens the workspace; `grant_draft.purpose = 'standard_answers'` is the one built-in Standard Answers draft per client, whose approved sections publish to `answer` with `draft_section_id` pointing back.
- Phase 3.1 (0043): **sensitive cards** (`lib/card-sensitivity.ts`, pure: a protected topic and a person in the same sentence, or the reader's `sensitive` flag; assessed at every merge by `assessLibrarySensitivity`; an undecided sensitive card cannot be placed, approved or copied) · **Arrange for me** and section recommendation (`arrangePicks`, `recommendSection` in `lib/story-card-rank.ts`) · **client Story Cards** at `/story-cards` (feature `card_review`, hidden by default; clients read their own cards by RLS select policies, write through `lib/server/client-card-actions.ts`; shared edit rules in `lib/server/card-edit.ts`) · **exports** `/api/export/cards` (.csv) and `/api/export/answers` (.md), also inside the Inven(s)tory zip · **chat searches Story Cards first** (`retrieveCards` in `lib/server/rag.ts`).
- Phase 3.2 (0044, 0045), the **Storyboarding Tool**: sidebar "Draft an Application" (`/draft` triage, admin-only and not a client toggle; `/draft/new` shows the Standard Answers explainer until every recommended question is approved, `lib/server/draft-start.ts`) and "Drafts" (`components/DraftsView.tsx`: Standard Answers pinned, filter by status, sort by deadline). Removing a card by dragging it onto the Story Cards panel asks first unless the user turned that off (`app_user.ui_prefs.confirm_card_remove`, Account page); edited cards and own text always ask; 8-second undo (`restoreBlockAction`). Typical lengths for Standard Answers: `TYPICAL_WORDS` in `lib/story-card-rank.ts`, overridden by `grant_question.typical_limit`. **Versions**: `lib/draft-version.ts` (pure) and `lib/server/version-actions.ts`; a version is the whole draft as JSON in `draft_snapshot.content`, saved before Weave and Polish (`enterStageAction`, for Phase 4), on Completed and Submitted, by name, every ten minutes of editing (skipped when unchanged; older autosaves thinned to one a day), and before any restore. Statuses add `completed` (editable); `submitted`, `won`, `lost` lock the draft: `loadSection` in `workspace-actions.ts` refuses every write, and "Start a new version from this one" (`newDraftFromAction`) copies it.
- Cleanup (0046, 0047, October 2026): **bracket drafts are gone** (every draft is a Storyboarding Tool draft; `draft_bracket` and `grant_draft.body` dropped; `grant_draft.mode` can only be `cards`; clients read no drafts, though Account still counts them through `getClientStats`). **The Answer Library page is gone**: the `answer` table now holds only approved Standard Answers (written by `approveStandardAnswerAction`), read by the Storyboard, `draft-start.ts`, the garden and the Inven(s)tory export ("Standard Answers.md"). **Drafts is off for clients by default**; Draft an Application is admin-only. Removed: the Dashboard toggle and `/dashboard`, `/api/si/generate`, the old whole-file `/api/upload`, the paused answer generator. `proposeOverlayAction` is admin-only until a client way to suggest funders exists.
- **Inven(s)tory Analysis, Phase A (0048), on trial**: one read per document returning its type, Story Cards and facts (`lib/analysis.ts`, pure: `DOC_TYPES`, `FACT_KEYS`, `checkFact`, `decideDocument`, `previewLibrary`, `reviewSample`, `reviewTally`; cards go through the Card Library's own `checkCandidate`) · `lib/server/analysis-extract.ts` (the read) · `lib/server/analysis-build.ts` (one stage) · `/api/jobs/analysis` and `/continue` (server-carried chain; signatures scoped `analysis-chain` in `job-chain.ts`) · `/admin/analysis` (`components/AnalysisTrialView.tsx`: Documents, Cards, Facts, and the 50-card Review that is the gate). Writes only `analysis_doc` and `analysis_review`, both admin-only: **nothing a client sees reads them** until Phase B passes its comparison. New card kind `funding_source` (item `other_funding`). A funder's blank form (`funder_form`) yields no cards or facts. **Phase B (0049)**, on the same page's Compare tab: `lib/analysis-derive.ts` (pure, tested) works out readiness from document types and card kinds (`deriveReadiness`; mapping tables `EXTRA_KIND_ITEMS`, `THIN_ONLY_KINDS`, `FACT_ITEMS`; the founder interview needs a client speaker in the roster), Funding Eligibility suggestions from facts (`deriveEligibility`, never saved), and search-profile facts (`deriveSearchFacts`, `KIND_FACET`, `FACT_FACET`). `lib/server/analysis-compare.ts` sets each beside what the portal uses today; a person judges every readiness disagreement (`analysis_verdict`, which records both states so a re-read that changes either side reopens it). Still read-only: nothing a client sees uses the derived values until Phase D.
- **Card Library builds are carried by the server** since Phase 3.1. The page starts the build (`kick`); each stage runs in `/api/jobs/cards/continue` (no session: authorised by an HMAC over tenant and job, `lib/server/job-chain.ts`, keyed with `JOB_CHAIN_SECRET` or the service-role key) and hands on to the next with `after()`. `/api/jobs/active` feeds the portal-wide `BuildNotice` (progress, an estimate from recent pace, a done or stopped notice) and restarts a chain that has gone quiet for 100 seconds. At most 60 stages per build (`job.chain_passes`).

## When working here
1. Clone into a folder named `invenstory-portal`.
2. Make changes; keep every service-role tenant-table call scoped or `// tenant-safe:` annotated.
3. `npm run build` (runs the tenancy check + compile) before deploying.
4. Commit, push to `main`, then `vercel deploy --prod` from the correctly-named folder; confirm it aliases `portal.forgranted.com`.
5. DB schema changes → deliver migration SQL for a human to apply; do not attempt direct DB writes from the sandbox.

## Handing a patch to Shane

Shane applies every patch by hand in `~/Desktop/fg-portal-push` and pushes from
there. The agent never pushes to his repo: "let's keep things manual for now, I
like our review loop."

**The preflight must GATE, not merely print.** The first version of this rule
put `git status --short && git log --oneline -1` at the top of the block, which
printed the answer and then ran `git am` anyway, in the same paste, before
anybody could read it. That is not a check, it is a caption.

```
cd ~/Desktop/fg-portal-push
git fetch -q origin main
git status --short && git log --oneline -1
git apply --check ~/Desktop/<name>.patch && git am ~/Desktop/<name>.patch && git push origin main
```

`git apply --check` is a dry run. If the patch cannot apply, for any reason
including having already been applied, it exits non-zero and the `&&` chain
stops before `git am` runs. Nothing is touched and there is no half-applied
state to unwind afterwards.

Line three still prints the branch and the current commit, which is worth
reading, but nothing now depends on somebody reading it in time.

**Why, from three failures in one night.** Each one produced output that looked
like success or looked like disaster, and was neither.

- `git am` applied onto a leftover branch (`fix/completeness-free-points`) that
  happened to sit at the same commit as `main`. Everything reported success and
  `git push` said "Everything up-to-date", because `main` genuinely had nothing
  new. Nothing deployed. `git status --short` names the branch it is about to
  patch.
- A half-applied `git am` left new files staged, so the next attempt failed with
  "already exists in index" alongside real hunk failures. `git am --abort`
  unwinds it.
- Re-applying a patch that had **already** landed produced the same alarming
  output plus "Everything up-to-date", which was literally true. Check
  `git log --oneline -1` against the expected commit before diagnosing anything.
  This happened **twice**, because a printed check that does not gate does not
  prevent anything. `git apply --check` is the fix; the earlier advice was not.

**Migrations go first, in their own message**, as a comment-stripped block to
paste into the Supabase SQL editor, with a plain-English note on what the change
accomplishes and what it touches. Say explicitly when a change is additive and
touches no existing data, because that is what makes it safe to paste. Then
verify it from the read-only Supabase connector rather than asking Shane to run
check queries.

**After the push**, confirm the deploy from the Vercel connector (state READY,
the right commit sha) and realign the sandbox with `git reset --hard
origin/main`. The stop hook reports the sandbox being one commit ahead until
that happens; that is expected and not something to act on.

**Say which button to press afterwards, and why.** A change to the merge rule
needs `re-merge`, which is free. A change to what is extracted needs `Rebuild`,
which is minutes and real money. Getting that wrong wastes both.
