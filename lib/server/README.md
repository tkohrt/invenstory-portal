# lib/server — server-only modules

All files here run only on the server. Grouped by concern:

## Auth / session / clients
- `session.ts` — read the authenticated session/user.
- `supabase.ts` — `userClient()` (RLS-respecting, session-scoped).
- `db.ts` — `db` service-role client (**bypasses RLS**; use with care — see
  `docs/SERVICE_ROLE_AUDIT.md`).
- `gate.ts` — route/feature access checks.

## Data access
- `data.ts` — read queries for the portal (documents, chats, stats, garden, etc.).
- `filename.ts` — safe download filename resolution.

## Document lifecycle
- `actions.ts`, `doc-actions.ts` — upload, tag, rename, reprocess, delete, and
  **layer changes** (drag-and-drop / drawer editor).
- `ingest.ts` — text extraction + chunking pipeline.
- `embed.ts` — chunk embedding via the Supabase Edge Function.

## Search / AI
- `llm.ts` — provider-agnostic generation (`chatComplete`, provider selection).
- `bedrock.ts` / `bedrock-check.ts` — AWS Bedrock client + diagnostics.
- `vertex-check.ts` — Google Vertex diagnostics.
- `rag.ts` — retrieval-augmented, cited answer construction.
- `refine.ts` — extractive fallback ranking.

## Features
- `answers.ts`, `answer-actions.ts` — Answer Library.
- `artifacts.ts`, `artifact-actions.ts`, `si-registry.ts` — Story Intelligence.
- `drafts.ts`, `draft-actions.ts` — Grant Drafts.
- `garden.ts`, `garden-actions.ts`, `garden-email.ts` — the Garden (score/size/
  health engine, cosmetic state, flag-gated growth emails).
- `account-actions.ts`, `admin-actions.ts` — account + admin operations.
- `notify.ts` — client-upload notifications (Resend + Slack).
