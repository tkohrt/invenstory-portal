# Inven(s)tory Portal — Agent Guide (CLAUDE.md)

Multi-tenant client portal for **For Granted** (grants-partnership firm; founders Tyler Kohrt & Shane Winnyk). Each client is a *tenant*; the portal holds their **Inven(s)tory** — a layered, searchable knowledge base of everything that makes them fundable — and derives readiness, eligibility, and (soon) research + drafting from it.

## Stack
- **Next.js (App Router, Turbopack), Next 16** on **Vercel** → https://portal.forgranted.com
- **Supabase**: Postgres + Row-Level Security, Storage (private `documents` bucket), pgvector
- **Embeddings**: Supabase edge function `gte-small` (384-dim) — `lib/server/embed.ts`
- **LLM**: AWS Bedrock via `lib/server/llm.ts` `chatComplete({system,user,maxTokens,temperature})`
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

## Key files
- `lib/server/db.ts` (lazy service client) · `lib/server/supabase.ts` (userClient/RLS) · `lib/server/session.ts` (tenant resolution)
- `lib/server/doc-extract.ts` (primary readiness) · `lib/server/gap-agent.ts` (audit/legacy) · `lib/checklist.ts`
- `lib/server/garden.ts` · `components/Shell.tsx` · `components/ReadinessCard.tsx` · `components/ReadinessAuditView.tsx` · `components/GardenPanel.tsx`
- `lib/server/ingest.ts` · `scripts/check-tenant-scoping.mjs` · `supabase/migrations/`

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

**Always give the preflight in the same block as the apply.** Not as advice
beside it, in the block, so it is run rather than read:

```
cd ~/Desktop/fg-portal-push
git status --short && git log --oneline -1
git am ~/Desktop/<name>.patch
git push origin main
```

Clean output from line two, and the commit you generated the patch against,
means go. Anything else means stop and look.

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
