# Architecture

## Tenancy model

Every row of client data carries a `tenant_id`. A logged-in user belongs to exactly
one tenant (`app_user.tenant_id`); For Granted staff have `role = 'admin'`. The
**authoritative isolation control is Postgres Row-Level Security (RLS)**, not
application code. Two `SECURITY DEFINER` helpers drive every policy
(`supabase/migrations/0002_rls.sql`):

- `current_tenant_id()` → the caller's tenant, derived from `auth.uid()` (the
  session), never from request input.
- `is_admin()` → whether the caller is For Granted staff.

Policies read `using (tenant_id = current_tenant_id() or is_admin())`. RLS is
enabled on **all** tables; a table with no policy is locked by default.

## Two database clients (critical distinction)

- **`userClient()`** (`lib/server/supabase.ts`) — carries the user's session, so
  **RLS applies**. Use this for anything driven by user input, and to *verify
  ownership* before a privileged write.
- **`db`** (`lib/server/db.ts`) — the **service-role** client, which **bypasses
  RLS**. Use only for operations that are already proven safe (ownership verified
  via `userClient()` first, or an explicit `tenant_id` filter, or a genuinely
  global table). Every `db.from` call site is catalogued in
  `docs/SERVICE_ROLE_AUDIT.md` and must be individually justified.

The safe pattern (see `lib/server/doc-actions.ts`): verify the row is in the
caller's tenant through `userClient()` (RLS returns nothing if not), *then* perform
the write with `db` scoped to that verified tenant, and append to `audit_log`.

## Request flow

Browser → Server Component / Server Action (session read via `@supabase/ssr`) →
Supabase (RLS-enforced) → render. Mutations are **server actions**, so there are
few open API endpoints and all input is validated server-side.

## Ingestion & search pipeline

Upload → store original in Supabase Storage → extract text → chunk → embed each
chunk (Supabase Edge Function, gte-small 384-dim) → store in `document_chunk` /
`chunk_embedding`. Search combines Postgres full-text with pgvector similarity
(`match_chunks`). Retrieval is always tenant-scoped by RLS.

## AI layer

`lib/server/llm.ts` is provider-agnostic: `generationProvider()` selects Bedrock
(primary) or Vertex (fallback); `chatComplete()` is the single entry point.
`lib/server/rag.ts` builds grounded, cited answers from retrieved chunks. Model
output is treated as untrusted content — it is never allowed to drive a privileged
action.

## Key modules (`lib/server/`)

See `lib/server/README.md` for the grouped file index (auth/session, data access,
document actions, AI/RAG, answers, garden, admin, notifications).

## Data model highlights

- `tenant`, `app_user` — orgs and their users.
- `document`, `document_chunk`, `chunk_embedding`, `document_tag`,
  `document_version` — the Inven(s)tory content and its search index.
- `chat_session`, `chat_message` — stored "Ask your Inven(s)tory" history.
- `grant_question`, `answer`, `answer_citation`, `answer_event` — Answer Library.
- `grant_draft`, `draft_bracket` — drafting workspace.
- `artifact_type/set/card` — Story Intelligence.
- `plant_state`, `achievement` — the Garden (computed score/size/health are derived
  on read, only achievements + cosmetic state persist).
- `feature_visibility` — per-tenant feature toggles.
- `audit_log` — actor/tenant/action trail for mutations.
