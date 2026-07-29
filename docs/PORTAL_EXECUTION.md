# PORTAL_EXECUTION.md — the how

Companion to PORTAL_PLAN.md (the why). Any AI session (or human) resuming this build:
read this file top to bottom, check the Status Log, start at the first unchecked phase.
Git log is the build journal — commit after every completed phase, messages say what AND why.

## Ground rules (unskippable)
- Tenant isolation enforced by Postgres RLS; verified by the attack-probe script after EVERY migration and deploy.
- Service-role key is server-only. Secrets live in .env.local (gitignored) and Vercel env vars. Never in git, never in chat.
- Verify every CLI write with its list command. Verify deploys on the canonical alias, not hash URLs.
- Fixture UUIDs: hex characters only.
- Introspect installed SDK surfaces before writing against them (node -e "console.log(Object.keys(require('pkg')))").
- Test triggers with a real INSERT immediately after applying schema.

## Environment contract
See .env.example — those names are the contract between code, local dev, and Vercel.
Bedrock region is us-east-1 (Titan embed v2 not served on-demand in us-east-2; verified 2026-07-28).

## Accounts and identities (verified 2026-07-28)
- GitHub: tkohrt (repo owner). Commit email: 301011219+tkohrt@users.noreply.github.com
- Vercel: tyler-2114 (token verified via `vercel whoami`)
- Supabase: token verified via `projects list`. Project "Inven(s)tory" ref dafofmvbbggrmyfnjspg, region us-east-1 (co-located with Bedrock).
- AWS: account 065148797929, IAM user portal-build (Bedrock+Textract only). Root has MFA; $25 budget alarm set.
- Claude (Anthropic) model authorization: PENDING new-account restriction; not needed until Phase 6. Nova is the form-free fallback.

## Phases
Full detail per phase lives in PORTAL_PLAN.md §7. Checklist:
- [x] Phase 0 — accounts, credential verification, this repo. (2026-07-28)
- [x] Phase 1 — Next.js scaffold. (2026-07-29) tsc clean, `next build` clean, 7 routes. Preview: https://invenstory-portal.vercel.app (canonical alias verified 200 + content grep). lib/types.ts + lib/mock-data.ts + lib/data.ts are the schema contract/swap point; lib/session.tsx is the Phase 4 swap point. Dependabot alerts + security updates enabled by Tyler 2026-07-29. Vercel project: for-granted/invenstory-portal.
- [ ] Phase 2 — migrations, RLS everywhere, storage path policy {tenant}/{doc}/{version}; attack-probe script committed at scripts/probe.ts; HUMAN reviews probe output. Pre-RLS dump as rollback.
- [ ] Phase 3 — data.ts swap, uploads, ingestion worker (extract → Textract if scanned → chunk w/ page+offsets → Titan embed → write). Status chips live.
- [ ] Phase 4 — Supabase Auth via management API; signups OFF (invite-only); TOTP MFA; Resend SMTP (HUMAN: 2 DNS records); admin = role-table membership; callback handles ?code= AND ?token_hash=.
- [ ] Phase 5 — Postgres FTS (tsvector generated column, GIN, websearch_to_tsquery, ts_headline); cross-tenant search probe.
- [ ] Phase 6 — RAG chat: tenant filter BEFORE similarity (verify query plan); streamed answers, citations, refusal state, per-user rate limit; model eval (Claude Haiku-class vs Nova) on real Q&A; cost-per-chat logged.
- [ ] Phase 7 — Artifact engine (artifact_type/set/card), Slack routing, unified review queue; Themes + Impact Metrics registered; PROOF: throwaway third type in under a day, zero backend changes.
- [ ] Phase 8 — Grant Drafts workspace; [BRACKET] question cards; answers file back as embedded Inven(s)tory entries.
- [ ] Phase 8.5 — HARDENING GATE (unskippable): fresh-eyes red team, hostile-document injection probe, upload hygiene, rate limits, headers, session behavior, audit-log spot check; real-device pass by BOTH founders; Lighthouse a11y 90+; sign-off recorded here.
- [ ] Phase 9 — Supabase Pro + Vercel Pro (HUMAN buys), portal.forgranted.com DNS (HUMAN adds CNAME), full probe suite vs production, backup restore demonstrated, then first client invite.

## Dependency security posture (2026-07-29)
- postcss + sharp advisories (production-relevant, shipped in Next): FIXED via package.json overrides (postcss ^8.5.18 -> 8.5.24, sharp ^0.35.0 -> 0.35.3). Keep overrides until Next bumps its pins, then remove.
- brace-expansion DoS advisories: residual HIGH flags confined to the ESLint dev toolchain (linter only, never deployed; exploitation requires hostile glob input to the linter on a dev machine). No non-breaking fix exists today: the fix chain requires eslint@10, which breaks eslint-plugin-react (verified: getFilename crash). DECISION: accept + document, dismiss Dependabot alerts with reason "vulnerable code not invoked at runtime", RE-CHECK at Phase 8.5 gate — ecosystem patch will likely land well before then.
- eslint@9 retained; lint is clean and caught one real bug (setState-in-effect in Shell.tsx, fixed by closing nav on link tap).

## Status log
- 2026-07-29: NAMING — client-facing term for artifact-engine output is "Story Intelligence"; SI panels moved off Library onto /story-intelligence/[slug] pages (registry-driven nav). Internal name remains artifact engine.
- 2026-07-28: Phase 0 executed. All four credentials verified by live calls (sts get-caller-identity; Titan embed test call returned 1024-dim vector in us-east-1; supabase projects list; vercel whoami; GitHub API /user).
- 2026-07-28: FINDING — Supabase project "Inven(s)tory" was created in Canada (Central). Recommended: recreate in us-east-1 (co-locate with Bedrock; keep client data + AI processing in one US region) while project is empty. Region cannot be changed after creation. RESOLVED 2026-07-29: Canada project deleted via Management API; recreated in us-east-1 (ref dafofmvbbggrmyfnjspg). DB password in password manager + .env.local (SUPABASE_DB_PASSWORD).
- 2026-07-28: FINDING — GitHub PAT is fine-grained and could not create repos (Administration permission missing). Repo created manually; token needs Contents read/write for push.
- 2026-07-28: Claude use-case form blocked by new-account restriction; retry after 24h or AWS support case (Account and billing, free tier).

## Paste this to the next AI
"Continue the Inven(s)tory Portal build. Repo: github.com/tkohrt/invenstory-portal. Read docs/PORTAL_EXECUTION.md, check the Status Log, start at the first unchecked phase. Credentials are in .env.local locally / ask Tyler to paste tokens. Never skip a probe checkpoint."
