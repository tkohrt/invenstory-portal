# Contributing

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`chore:`, `docs:`, `refactor:`, `test:`, `perf:`. One logical change per commit,
imperative mood, present tense. Example: `fix: scope answer query to caller tenant`.

## Branches & PRs

- `main` is production (auto-deploys to Vercel). Protect it: require a PR + review.
- Branch per change; open a PR; CI (typecheck + lint) must pass.

## Database migrations

- Migrations are **numbered and forward-only** in `supabase/migrations/`. Never edit
  an already-applied migration — add a new one.
- **Every new table must enable RLS and define tenant-scoped policies** in the same
  migration. A table without a policy is inaccessible by design; a table without RLS
  enabled is a data leak.
- Prefer the Supabase CLI so migrations are reviewed and reproducible across
  local / staging / production.

## Security-sensitive code

- Any new `db.from(...)` (service-role) usage must be justified and added to
  `docs/SERVICE_ROLE_AUDIT.md`. Prefer `userClient()` (RLS-respecting) unless you
  have verified ownership first.
- Validate all server-action inputs. Treat AI/model output as untrusted.

## Environment

Keep `.env.example` authoritative: every `process.env.X` referenced in code must
appear there with a one-line comment. Never commit real values.
