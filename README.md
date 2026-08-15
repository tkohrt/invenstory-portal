# Inven(s)tory Portal

For Granted's multi-tenant client portal. Each client ("tenant") logs in to view,
search, and ask AI questions about their own **Inven(s)tory** — a structured,
three-layer knowledge base of the documents that make their organization fundable.
Clients only ever see their own data; isolation between tenants is the product's
most important guarantee.

## What it does

- **Documents in three layers** — Layer I (public story), Layer II (internal
  strategy), Layer III (living voice: interviews, updates). Drag-and-drop to move
  documents between layers.
- **Full-text + semantic search** over a client's documents (pgvector embeddings).
- **Ask your Inven(s)tory** — retrieval-augmented AI chat, grounded only in that
  client's documents, with inline source citations.
- **Story Intelligence** — generated fundability snapshots, impact metrics, themes.
- **Answer Library** — a reusable bank of grant-question answers per client.
- **Grant Drafts** — a drafting workspace with bracketed capture.
- **The Garden** — a living plant visualizing each Inven(s)tory's growth and
  freshness (see `docs/GARDEN_SPEC.md`).
- **Admin views** — For Granted staff can view any client, download originals, and
  see a portfolio "greenhouse."

## Stack

- **Next.js** (App Router) on **Vercel**. Mutations are server actions, not open
  API routes.
- **Supabase**: Postgres (with **pgvector**), Auth (`@supabase/ssr`, httpOnly
  cookies), Storage (original files). **Row-Level Security is the core isolation
  control** — see `SECURITY.md`.
- **AI**: AWS Bedrock (Claude) for chat/generation, Google Vertex fallback, behind
  a provider-agnostic layer (`lib/server/llm.ts`). Embeddings via a Supabase Edge
  Function (gte-small, 384-dim).
- **Email**: Resend (client notifications; growth emails built but flag-gated).

## Repository layout

```
app/                  Next.js routes (App Router) — (portal) group + api/
components/            React components
lib/                  Shared code; lib/server/* is server-only (see lib/server/README.md)
supabase/migrations/  Numbered, forward-only SQL migrations (RLS lives here)
docs/                 Architecture, specs, handoff, service-role audit
public/               Static assets
design/               Living design prototype
```

## Local development

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values (never commit `.env.local`).
3. Apply migrations to your Supabase project (Supabase CLI recommended) in numeric
   order from `supabase/migrations/`.
4. `npm run dev` → http://localhost:3000

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build (also typechecks)
- `npm run lint` — ESLint
- `npm run typecheck` — `tsc --noEmit`

## Deploying

Pushes to `main` deploy to Vercel production. Use a preview branch + a separate
Supabase project for staging (see `docs/HANDOFF.md`).

## Documentation

- `ARCHITECTURE.md` — how the system fits together and how tenancy is enforced
- `SECURITY.md` — threat model and security controls
- `CONTRIBUTING.md` — commit conventions and migration discipline
- `docs/HANDOFF.md` — **read this first if you're the incoming team**
- `docs/SERVICE_ROLE_AUDIT.md` — inventory of RLS-bypassing queries to review
- `docs/PORTAL_PLAN.md` / `docs/PORTAL_EXECUTION.md` — why & how it was built
- `docs/ANSWER_LIBRARY_SPEC_V2.md`, `docs/GARDEN_SPEC.md` — feature specs
