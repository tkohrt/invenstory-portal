# Tests — cross-tenant isolation suite

A starting-point suite proving the product's core guarantee: **one client can
never read or modify another client's data.** It exercises the real boundary —
Postgres Row-Level Security — by provisioning two live tenants, authenticating as
each, and attempting cross-tenant access through the RLS-enforced anon client.

Written as a handoff starting point (For Granted, Aug 2026). Extend it as features
grow — every new tenant-scoped table should get probes here.

## Safety

**Never run against production.** The harness hard-fails if `TEST_SUPABASE_URL`
points at a known production project ref (`tests/isolation/setup.ts`). Use a
dedicated test/staging Supabase project. The suite creates and deletes real
tenants + auth users, so it must own its database.

## Setup

1. Create a staging Supabase project and apply all migrations to it.
2. Install dev deps: `npm i -D vitest @supabase/supabase-js`
   (`@supabase/supabase-js` may already be a dependency.)
3. Provide env (a `.env.test`, or export before running):
   ```
   TEST_SUPABASE_URL=https://<staging-ref>.supabase.co
   TEST_SUPABASE_ANON_KEY=<staging anon key>
   TEST_SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
   ```
4. `npm run test`  (or `npm run test:isolation`)

## What it covers

- **Reads:** A cannot select B's document, chunks, tags, chat session/messages,
  grant draft, or plant_state by id; blanket selects never include B's rows.
- **Positive control:** A can see its own document (guards against false passes).
- **Writes:** A cannot update/delete B's rows, and cannot insert into B's tenant
  (RLS `with check`).
- **Enumeration:** A cannot list other tenants or their users.
- **Embedding search:** the `match_chunks` RPC never returns another tenant's
  chunks (skips automatically if the RPC name differs).
- **RLS coverage:** asserts no `public` table has `rowsecurity=false` on the live
  DB (prints the manual SQL if no exec RPC is available).

## Next tests to add (recommended)

- Storage: A cannot download B's original files via signed/public URLs.
- Admin boundary: a `client`-role user cannot reach admin-only data or actions.
- Answer Library: A cannot read/modify B's `answer` / `answer_citation` rows
  (add answer provisioning to `setup.ts`).
- Audit log: A cannot read B's `audit_log` entries.
- Each server action: call with a forged/other-tenant id and assert failure.
