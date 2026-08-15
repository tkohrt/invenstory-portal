# Security

## Threat model

The primary guarantee: **a client must never be able to read or modify another
client's data** — documents, file downloads, chats, answers, drafts, embeddings,
garden state, or audit entries. Everything below serves that guarantee.

## Controls in place

- **Row-Level Security on every table**, scoped by `current_tenant_id()` /
  `is_admin()` (`supabase/migrations/0002_rls.sql`). Default-deny.
- **Tenant identity is server-derived** from the authenticated session, never from
  client input — it cannot be spoofed by tampering with a request.
- **Auth via `@supabase/ssr`** with httpOnly cookies; tokens are not exposed to
  page JavaScript.
- **Mutations are server actions**, validated server-side.
- **Audit log** records mutations (actor, tenant, action).
- **Secrets** live only in environment variables (`.env.local`, Vercel env). `.env`
  is gitignored; only `.env.example` (names, no values) is committed.

## Known areas requiring ongoing diligence

1. **Service-role queries bypass RLS.** ~116 `db.from` call sites exist; each must
   be justified. See `docs/SERVICE_ROLE_AUDIT.md` and clear every `FIX NEEDED`.
2. **Supabase Storage policies** must be tenant-scoped independently of table RLS;
   the admin "download any client's file" path must enforce `is_admin()` on the
   server, not just hide a button.
3. **Prompt injection** via uploaded documents: retrieval is tenant-scoped, so the
   blast radius is a client's own data, but confirm the retrieval query can never
   cross tenants and never let model output trigger privileged actions.
4. **No automated tests / CI yet** — the highest-value first suite is cross-tenant
   isolation tests (log in as A, attempt to reach B's resources by ID, assert
   failure). CI template in `docs/ci.yml.example` (add to `.github/workflows/`). A starter cross-tenant isolation suite lives in `tests/` — see `tests/README.md`.

## Before scaling

- Live RLS audit against `pg_tables.rowsecurity` (verify the running DB, not just
  migrations).
- Rate-limiting on auth and AI endpoints.
- Security headers + Content-Security-Policy (re-verify after changes).
- Zod validation at every server-action boundary.
- Dependency scanning (Dependabot config added) + a secret scanner in CI.
- A third-party penetration test once the codebase stabilizes.

## Reporting a vulnerability

Email security@forgranted.com (or info@forgranted.com). Do not open a public issue
for a suspected data-isolation or auth flaw.

## Credential rotation

All infrastructure credentials should be rotated on team handoff (Supabase anon +
service-role + management token, Vercel token, GitHub PAT, AWS keys, Resend key)
and any admin/shared passwords changed. Rotating infrastructure keys does **not**
require clients to change their passwords (see `docs/HANDOFF.md`, "What clients will
and won't notice").
