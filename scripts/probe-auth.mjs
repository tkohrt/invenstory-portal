// Authenticated-attacker probes — the tests that matter most (playbook:
// "a logged-in attacker, not an anonymous one"). Signs in as a REAL client
// user and attempts to reach another tenant's data. Requires env:
// SUPABASE_URL, SUPABASE_ANON_KEY, PROBE_CLIENT_EMAIL, PROBE_CLIENT_PASSWORD.
import { createClient } from "@supabase/supabase-js";
const { SUPABASE_URL, SUPABASE_ANON_KEY, PROBE_CLIENT_EMAIL, PROBE_CLIENT_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !PROBE_CLIENT_EMAIL || !PROBE_CLIENT_PASSWORD) { console.error("missing env"); process.exit(2); }

const KHAI = "a2000000-0000-4000-8000-000000000002"; // the OTHER tenant
const FTC  = "a1000000-0000-4000-8000-000000000001"; // Lili's own tenant
let failures = 0;
const check = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); if (!ok) failures++; };

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email: PROBE_CLIENT_EMAIL, password: PROBE_CLIENT_PASSWORD });
check("client can sign in", !authErr && !!auth.session, authErr?.message ?? PROBE_CLIENT_EMAIL);

// 1. See own tenant's documents (positive control)
{
  const { data } = await sb.from("document").select("id").eq("tenant_id", FTC);
  check("client sees OWN tenant documents", (data?.length ?? 0) > 0, `rows ${data?.length ?? 0}`);
}
// 2. THE test: read another tenant's documents -> must be empty
{
  const { data } = await sb.from("document").select("id, title").eq("tenant_id", KHAI);
  check("client CANNOT read other tenant documents", (data?.length ?? 0) === 0, `rows ${data?.length ?? 0}`);
}
// 3. Read another tenant with NO filter (rely on RLS alone)
{
  const { data } = await sb.from("document").select("tenant_id");
  const foreign = (data ?? []).filter(d => d.tenant_id !== FTC);
  check("unfiltered document read leaks NOTHING cross-tenant", foreign.length === 0, `foreign rows ${foreign.length}`);
}
// 4. Read another tenant's Story Intelligence cards -> empty
{
  const { data } = await sb.from("artifact_card").select("id").eq("tenant_id", KHAI);
  check("client CANNOT read other tenant artifact_card", (data?.length ?? 0) === 0, `rows ${data?.length ?? 0}`);
}
// 5. Forge a document INTO another tenant -> rejected by WITH CHECK
{
  const { error } = await sb.from("document").insert({
    tenant_id: KHAI, title: "FORGED BY LILI", layer: "I", storage_key: "x/y/1",
    doc_kind: "note", uploaded_by: "b3000000-0000-4000-8000-000000000003", snippet: "attack" });
  check("client CANNOT forge document into other tenant", !!error, error ? `${error.code} ${error.message.slice(0,40)}` : "INSERT SUCCEEDED");
}
// 6. Read the audit_log (admin-only) -> empty/blocked
{
  const { data } = await sb.from("audit_log").select("id");
  check("client CANNOT read audit_log", (data?.length ?? 0) === 0, `rows ${data?.length ?? 0}`);
}
// 7. Read another tenant's chunk text (the RAG leak path) -> empty
{
  const { data } = await sb.from("document_chunk").select("id").eq("tenant_id", KHAI);
  check("client CANNOT read other tenant chunks (RAG isolation)", (data?.length ?? 0) === 0, `rows ${data?.length ?? 0}`);
}


// 8. Search isolation: run the FTS RPC as this client; results must be OWN
//    tenant only. "screening"/"perinatal" exist only in KHAI's documents.
{
  const { data } = await sb.rpc("search_inventory", { p_query: "perinatal screening maternal" });
  const foreign = (data ?? []).filter(r => r.tenant_id !== FTC);
  check("search RPC returns NOTHING from other tenant", foreign.length === 0, `foreign hits ${foreign.length}`);
}
// 9. Search over own content works (positive control)
{
  const { data } = await sb.rpc("search_inventory", { p_query: "transportation" });
  check("search RPC finds OWN documents", (data?.length ?? 0) > 0, `hits ${data?.length ?? 0}`);
}

await sb.auth.signOut();
console.log(failures === 0 ? "\nALL AUTHENTICATED PROBES PASSED — a logged-in attacker reaches nothing." : `\n${failures} PROBE(S) FAILED — STOP EVERYTHING.`);
process.exit(failures === 0 ? 0 : 1);
