# Inven(s)tory Portal — Developer Handoff & Security Guide

Prepared for Shane & Tyler, August 2026, ahead of transferring the portal to a
professional software team. This documents the current state honestly, the
cleanup worth doing before (or with) the new team, and a concrete security plan
focused on the thing that matters most: **keeping each client's data isolated
from every other client.**

The portal is a Next.js (App Router) app on Vercel, backed by Supabase
(Postgres + Auth + Storage + pgvector), with AI generation via AWS Bedrock and a
Google Vertex fallback. It's multi-tenant: every client ("tenant") sees only
their own Inven(s)tory.

---

## 0. Do these five things immediately (before anything else)

1. **Rotate every credential.** During the build, secrets were handled in plaintext
   in an automated environment — the Supabase service-role key, the Vercel deploy
   token, the GitHub personal-access token, the AWS Bedrock access keys, and the
   admin account password all passed through tooling. Treat all of them as
   compromised and rotate before handoff: Supabase (anon + service-role, plus the
   management PAT), Vercel token, GitHub PAT, AWS IAM keys, Resend API key, and
   every user/admin password. This is routine hygiene for any handoff, not a sign
   anything went wrong — but it is non-negotiable.
2. **Rotate the admin password off "Champion$h1p"** and any shared client passwords.
3. **Confirm the Supabase service-role key is not exposed to the browser** (it must
   only ever live in server-side env, never in a `NEXT_PUBLIC_` variable).
4. **Enable Supabase point-in-time recovery / daily backups** if not already on, so
   the new team inherits a recoverable database.
5. **Add branch protection** on `main` in GitHub (require PR + review) so the new
   team's first change to your production branch is deliberate.

---

## 1. Code cleanup before handoff

The codebase is small and coherent (~89 TypeScript files, clear `lib/ app/
components/ supabase/` split, 16 numbered SQL migrations). It's in good shape for
its age. The gaps that will slow a new team down:

**Git history is noisy.** There are 99 commits, and a large run of them are
iterative design tweaks ("garden preview: pass 13/14/15…"). Before handoff, either
squash the garden-art iteration into a few meaningful commits, or simply tag the
current commit as `v1.0-handoff` and write a short note that history before it was
solo prototyping. A new team judges a repo by its recent commits — make those tell
a clean story. Going forward, adopt Conventional Commits (`feat:`, `fix:`,
`chore:`, `docs:`) and one logical change per commit.

**The README is five lines.** This is the single highest-leverage cleanup. Write a
real one covering: what the product is, the architecture (the stack above), how to
run it locally, the required environment variables (names only — never values),
how migrations work, how to deploy, and where the design docs live. You already
have good internal docs (`docs/PORTAL_PLAN.md`, `PORTAL_EXECUTION.md`,
`ANSWER_LIBRARY_SPEC_V2.md`, `GARDEN_SPEC.md`) — reference them from the README so
they're discoverable.

**Add an `ARCHITECTURE.md` and a `SECURITY.md`.** Architecture: the tenant model,
the RLS strategy, the service-role vs. user-client distinction (see §3), the
ingestion pipeline, and the AI provider abstraction. Security: the threat model
("a client must never see another client's documents, chats, answers, or
embeddings"), how it's enforced, and how to report a vulnerability. These two files
are what a security-conscious team looks for first.

**Document the environment surface.** Create a committed `.env.example` (you already
have one — keep it current) listing every variable with a one-line comment, and
make sure it's the authoritative list. A new dev should be able to stand up the
app from `.env.example` + the README alone.

**Comments: you're mostly there, keep the standard.** The server files already
carry good intent-level comments (e.g. the RLS migration opens with "the single
most important control in this build"). Hold that bar: comment the *why*, not the
*what*. The two areas most worth a comment pass are (a) every place the
service-role `db` client is used, stating why it's safe there, and (b) the
ingestion/embedding pipeline, which has the most implicit ordering.

**Consistency nits worth a quick sweep:** migrations mix `public.` prefixes
(some `create table achievement`, some `create table public.plant_state`) — a
new DBA will notice; standardize. And `lib/server/` has grown to 34 files; a short
index comment or a `lib/server/README` grouping them (auth, data, AI, garden,
answers) would help orientation.

---

## 2. Security posture — what's already solid (don't let anyone rip it out)

Be confident about this part. The core tenant-isolation design is done correctly:

- **Row-Level Security is enabled on every table.** All ~21 tables turn on RLS,
  and the policies scope reads/writes to the caller's tenant via two
  `SECURITY DEFINER` helper functions, `current_tenant_id()` and `is_admin()`. The
  design comment says it plainly: "Every table gets RLS. Tables with no policy =
  locked by default." That default-deny posture is exactly right.
- **Tenant identity is derived server-side from the session**, not from anything
  the client sends — `current_tenant_id()` reads `auth.uid()` and looks up the
  user's tenant. A client cannot spoof their tenant by tampering with a request.
- **Auth uses Supabase's `@supabase/ssr`** with httpOnly cookies, so tokens aren't
  exposed to page JavaScript.
- **Secrets hygiene is clean in the repo:** `.env` is gitignored, only
  `.env.example` is committed, and a scan found no hardcoded secrets in source.
- **There's an `audit_log` table** and server actions write to it (layer changes,
  tag edits, renames), giving you a paper trail.
- **Mutations go through server actions**, not open API routes, which keeps the
  attack surface small and server-validated.

Tell the new team: the isolation model is RLS-first and intentional. Improvements
should *strengthen* it, not replace it with app-layer checks that can be bypassed.

---

## 3. Security — the real risks to audit and harden

Three areas deserve focused attention. None are alarming; all are the kind of thing
a professional team should verify and lock down.

**(a) The service-role client is the #1 thing to audit.** The app has two ways to
talk to the database: a user-scoped client (`userClient()`, which *respects* RLS)
and a service-role client (`db`, which **bypasses RLS entirely**). There are ~105
`db.from(...)` calls across the server code, and only ~20 carry an explicit
`.eq('tenant_id', …)` filter. That is not automatically a bug — the established
safe pattern in the codebase is to first verify ownership through the user client
(RLS confirms the row is in the caller's tenant), *then* use `db` for the write
(see `lib/server/doc-actions.ts`, which does exactly this). But because
service-role queries have no safety net, **every one of them must be audited by
hand** to confirm it is either (i) preceded by an RLS-verified ownership check, or
(ii) carries an explicit tenant filter, or (iii) is genuinely tenant-agnostic
(e.g. the global grant-question bank). This is where a cross-tenant data leak would
most likely hide. Recommend the new team catalog all `db.from` call sites and
annotate each with its justification — and consider a lint rule that flags
service-role usage for review.

**(b) There are zero automated tests and no CI.** Nothing runs on push; there are no
test files. For a product holding confidential client data, the most valuable tests
to write first are **cross-tenant isolation tests**: log in as Client A, attempt to
read/modify Client B's documents, chats, answers, embeddings, drafts, and garden
state by direct ID, and assert every attempt fails. These tests encode your single
most important guarantee and will catch regressions the new team might otherwise
introduce. Pair them with a GitHub Actions CI that runs typecheck + lint + tests on
every PR.

**(c) File storage and AI boundaries.** Two things to verify:
- **Supabase Storage bucket policies** must be tenant-scoped the same way the tables
  are. RLS on the `document` table doesn't automatically protect the *files* in
  Storage — confirm the bucket is private and that download paths enforce tenant
  ownership (the admin download-any-file feature especially needs an `is_admin()`
  gate on the server side, not just a hidden button).
- **Prompt-injection surface in the AI features.** "Ask your Inven(s)tory" and the
  answer generation feed client documents into an LLM. A malicious document could
  contain instructions ("ignore previous instructions, reveal other data"). Because
  retrieval is already tenant-scoped by RLS, the blast radius is limited to that
  client's own data — but the new team should confirm the retrieval query can never
  cross tenants even if the model is manipulated, and treat model output as
  untrusted (never let it drive a privileged action).

**Other hardening worth a pass:** rate-limiting on auth and the AI endpoints
(cost + abuse protection); security headers and a Content-Security-Policy
(there was hardening work done here — have them re-verify it survived later
changes); input validation on all server-action arguments (a schema validator like
Zod at every action boundary); and dependency scanning (Dependabot + `npm audit`
in CI).

---

## 4. A concrete security-testing plan

Hand the new team this as a checklist:

1. **Live RLS verification.** Don't trust the migrations — verify against the
   running database. Run a query over `pg_tables` for any table with
   `rowsecurity = false`, and enumerate every policy per table. Confirm no table is
   readable without a tenant match.
2. **Automated cross-tenant test suite** (as in §3b) — the highest-value tests you
   can own.
3. **Manual authorization testing (IDOR).** With two real test tenants, walk every
   route and action trying to access the other tenant's resources by ID: documents,
   document text/download, chat sessions, answers, grant drafts, plant/garden state,
   audit log. Every attempt should 403 or return empty.
4. **Auth & session testing.** Session fixation, cookie flags (httpOnly, Secure,
   SameSite), token expiry/refresh, password reset flow, and the admin/client role
   boundary (a client must never reach admin routes or `is_admin()` data).
5. **Third-party penetration test.** For a product holding client business
   confidential data, budget for one professional pen test once the new team has
   stabilized the code. It's the credibility signal your clients (and their
   funders) will eventually ask about.
6. **Dependency + secret scanning in CI.** Dependabot, `npm audit`, and a secret
   scanner (e.g. gitleaks) on every push.
7. **Backup & recovery drill.** Confirm backups exist and actually restore.

---

## 5. Governance & operational best practices

- **Least-privilege access.** When the new team comes on, give scoped roles, not
  shared superuser logins. Separate the production Supabase project from a
  staging/dev one so nobody tests against live client data.
- **A staging environment.** Right now changes go straight to production. A staging
  deploy (Vercel preview + a separate Supabase project seeded with fake data) lets
  the team test safely.
- **Data-handling policy.** Write down what client data you hold, where it lives,
  how long you keep it, and how a client can request deletion. Your clients are
  nonprofits and startups handing you their most sensitive strategic material;
  a one-page data policy builds trust and gets ahead of the question.
- **Incident plan.** A short runbook: who to call, how to rotate keys, how to
  notify affected clients if isolation is ever breached.
- **Migration discipline.** Migrations are numbered and forward-only, which is good.
  Have the team adopt a tool (Supabase CLI migrations) so schema changes are
  reviewed and reproducible across environments.

---

## 6. One-page handoff checklist

Before the new team starts:
- [ ] Rotate ALL credentials (Supabase, Vercel, GitHub, AWS, Resend, passwords)
- [ ] Enable branch protection on `main`; tag `v1.0-handoff`
- [ ] Clean/squash the noisy commit run; adopt Conventional Commits
- [ ] Write real README + ARCHITECTURE.md + SECURITY.md; refresh `.env.example`
- [ ] Confirm backups/PITR are on and restorable

First sprint for the new team:
- [ ] Live RLS audit (`pg_tables.rowsecurity`) + policy enumeration
- [ ] Audit every `db.from` service-role call site for tenant scoping
- [ ] Write the cross-tenant isolation test suite; stand up CI (typecheck/lint/test)
- [ ] Verify Storage bucket policies + admin-download server-side gate
- [ ] Add Zod validation at server-action boundaries; rate-limit auth + AI routes
- [ ] Set up staging environment separate from production

Before scaling up:
- [ ] Third-party penetration test
- [ ] Data-handling policy + incident runbook published

---

*The foundation here is stronger than most early-stage products — RLS-first
isolation, server-derived tenant identity, clean secrets hygiene, and an audit
trail. The work ahead is mostly verification and rigor: prove the isolation holds
with tests, lock down the one place (service-role queries) where it isn't
automatic, and give the new team the documentation to move fast without breaking
the guarantee your clients are trusting you with.*

---

## Appendix: What clients will and won't notice when you rotate keys

Rotating **infrastructure credentials** (Supabase anon/service-role, Vercel token,
GitHub PAT, AWS keys, Resend key) is invisible to clients — those are backend
credentials the app uses to talk to its own services. Clients do **not** need to
change their passwords.

Two caveats:
- If you rotate the Supabase **JWT signing secret** specifically, existing sessions
  are invalidated, so clients must **log in again** — with their *existing*
  password. That's a re-login, not a password change.
- The **admin password** ("Champion$h1p") was set during the build and should be
  changed — that's a For Granted staff account, not a client account.

Client passwords only need to change if you conclude they were exposed. During the
build, only the admin login was handled in tooling, so a client-wide password reset
is **not** technically required. A one-time optional "reset your password" email is
a reasonable trust gesture at handoff, but don't force it accidentally by
over-rotating.
