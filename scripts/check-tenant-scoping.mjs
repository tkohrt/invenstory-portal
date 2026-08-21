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
  "document_chunk","document_tag","document_version","draft_bracket","eligibility_gap",
  "eligibility_profile","eligible_grant","feature_visibility","grant_draft","plant_state",
]);
// app_user is tenant-scoped but identity lookups legitimately key on auth_id.
const IDENTITY_OK = new Set(["app_user"]);

const ROOTS = ["lib/server", "app"];
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
const violations = [];
for (const root of ROOTS) {
  let files; try { files = walk(root); } catch { continue; }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    let m;
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
