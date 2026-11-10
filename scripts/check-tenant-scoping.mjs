#!/usr/bin/env node
// Guards multi-tenant isolation: the service-role `db` client bypasses RLS, so
// every `db.from("<tenant-scoped table>")` call MUST carry an explicit tenant filter
// (tenant_id in a .eq/.match or in an insert/upsert payload), OR be explicitly
// marked cross-tenant-safe with a `// tenant-safe:<reason>` comment on/above the call.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Tables that carry tenant_id (from supabase/migrations). Keep in sync with schema.
const TENANT_SCOPED = new Set([
  "achievement","answer","answer_citation","answer_event","app_user","artifact_card",
  "artifact_set","audit_log","chat_message","chat_session","chunk_embedding","document",
  "document_chunk","document_tag","document_version","eligibility_gap",
  "eligibility_profile","eligible_grant","feature_visibility","grant_draft","job",
  "job_event","match_source_setting","tenant_setup","guide_question",
  "match_run","match_triage","matched_funder","plant_state","profile_edit","search_profile","search_profile_doc",
  // Card Library (0039).
  "story_card","story_card_version","story_card_evidence","story_card_doc","story_card_variant",
  // Drafter (0041). question_candidate is deliberately absent: For Granted IP
  // pooled across clients with no tenant_id, admin-only, like ledger_overlay.
  "draft_section","section_block","draft_snapshot","question_observation",
  // Drafting workspace (0042). Append-only event log.
  "card_event",
  // Inven(s)tory Analysis, Phase A (0048).
  "analysis_doc","analysis_review","analysis_dup_review",
  // Phase B comparison (0049).
  "analysis_verdict",
  // Phase C, the client's path (0050).
  "analysis_usage","analysis_request","analysis_suggestion_decision","analysis_client_state",
  // AI usage meter and client limits (0051).
  "ai_usage","usage_grant","usage_request",
  // Client activity visits (0052).
  "activity_event",
  // Remembered refusals, Phase D patch 1 (0053).
  "card_refusal",
  // The monthly AI allowance, Phase D patch 2 (0054).
  "ai_allowance",
  // For Granted asks the client (0058).
  "client_ask",
  // Polish: figures cleared by a person (0059).
  "figure_clearance",
  // Auto-Draft (0062).
  "voice_profile",
  "draft_context", "draft_form_item",
  // Document Reader, Phase 0 (0069).
  "document_text",
  // Web discovery, patch 5 of the 1 Nov 2026 build (0074).
  "discovery_run", "discovered_lead",
  // A client's own view of its matches, patch 7 (0075).
  "client_match_view",
]);
// app_user is tenant-scoped but identity lookups legitimately key on auth_id.
const IDENTITY_OK = new Set(["app_user"]);

// db.rpc functions that have been reviewed (red-team H2, 9 Nov 2026): each
// takes an explicit tenant argument or runs SECURITY INVOKER under RLS. Any
// OTHER function name called through the service-role client fails the build
// until it is reviewed and added here.
const RPC_REVIEWED = new Set(["client_ai_spend_micros", "tenant_word_count"]);

// Widened from ["lib/server", "app"] (red-team H2): a "use server" file or a
// db import can appear anywhere under these roots.
const ROOTS = ["lib", "app", "components"];
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const CALL = /\bdb\.from\(\s*["'`](\w+)["'`]\s*\)/g;
// Re-assigning db to another name would hide every later call from this
// script (red-team H2): `const svc = db; svc.from(...)` was never scanned.
// Ban the aliasing itself. Destructuring imports are matched too.
const ALIAS = /(?:const|let|var)\s+(?:\w+|\{[^}]*\})\s*=\s*db\s*[;,\n)]/g;
const RPC = /\bdb\.rpc\(\s*["'`](\w+)["'`]/g;
const violations = [];
for (const root of ROOTS) {
  let files; try { files = walk(root); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m;
    while ((m = ALIAS.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ file, line, table: "(alias)", snippet: `re-assigning db hides calls from this check: ${m[0].trim().slice(0, 80)}` });
    }
    while ((m = RPC.exec(src))) {
      if (RPC_REVIEWED.has(m[1])) continue;
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ file, line, table: `(rpc ${m[1]})`, snippet: "service-role rpc not in RPC_REVIEWED; review it (tenant arg or SECURITY INVOKER) and add the name" });
    }
    while ((m = CALL.exec(src))) {
      const table = m[1];
      if (!TENANT_SCOPED.has(table)) continue;
      // window = from this call until the next db.* call, statement end, or 600 chars
      const start = m.index;
      const rest = src.slice(start + 1);
      const stops = [/\bdb\.from\(/, /\bdb\.rpc\(/, /\bdb\.storage/, /;/].map(r => { const mm = r.exec(rest); return mm ? mm.index : Infinity; });
      const end = start + 1 + Math.min(600, ...stops);
      const window = src.slice(start, end);
      // preceding line (for tenant-safe annotation)
      const lineStart = src.lastIndexOf("\n", start);
      const prevLineStart = src.lastIndexOf("\n", lineStart - 1);
      const eol = src.indexOf("\n", start); const lineEnd = eol === -1 ? src.length : eol;
      const context = src.slice(prevLineStart + 1, lineEnd);
      const line = src.slice(0, start).split("\n").length;

      // A real filter (.eq/.in/.match/... on tenant_id) or an insert/upsert payload key — NOT a select column.
      const hasTenant = /\.(eq|neq|in|is|match|filter|contains|or)\(\s*[`"\']?tenant_id/.test(window) || /tenant_id\s*:/.test(window);
      const hasIdentity = IDENTITY_OK.has(table) && (/\.(eq|match|filter)\(\s*[`"\']?auth_id/.test(window) || /auth_id\s*:/.test(window));
      const annotated = /tenant-safe\s*:/i.test(context);
      if (!hasTenant && !hasIdentity && !annotated) {
        violations.push({ file, line, table, snippet: window.replace(/\s+/g, " ").slice(0, 110) });
      }
    }
  }
}

if (violations.length) {
  console.error(`\n✗ tenant-scoping check: ${violations.length} unscoped service-role call(s) on tenant tables:\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  db.from("${v.table}")  →  ${v.snippet}`);
  console.error(`\nEach must filter by tenant_id, or be marked with a "// tenant-safe:<reason>" comment.\n`);
  process.exit(1);
}
console.log("✓ tenant-scoping check passed — all service-role tenant-table calls are scoped or annotated.");
