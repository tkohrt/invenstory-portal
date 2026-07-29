// Attack-probe suite — run after EVERY migration and deploy, any environment.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/probe.mjs
// Exit code 0 = all attacks failed (good). Non-zero = STOP EVERYTHING.
// Phase 4 adds authenticated-user probes (cross-tenant forge with a real session).
const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SVC) { console.error("missing env"); process.exit(2); }
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const rest = (path, key, opts = {}) =>
  fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opts.headers ?? {}) } });

// 1. Anonymous reads of protected tables must return EMPTY (RLS silently filters)
for (const t of ["tenant", "app_user", "document", "document_chunk", "artifact_set", "artifact_card", "audit_log"]) {
  const r = await rest(`${t}?select=*`, ANON);
  const body = r.ok ? await r.json() : [];
  check(`anon read ${t} returns nothing`, r.ok && Array.isArray(body) && body.length === 0, `HTTP ${r.status}, rows ${Array.isArray(body) ? body.length : "n/a"}`);
}
// 2. artifact_type is signed-in-only: anon must see nothing
{
  const r = await rest("artifact_type?select=slug", ANON);
  const body = r.ok ? await r.json() : [];
  check("anon read artifact_type returns nothing", r.ok && body.length === 0, `rows ${body.length}`);
}
// 3. Anonymous forged INSERT must be rejected with an RLS violation
{
  const r = await rest("document", ANON, { method: "POST", body: JSON.stringify({
    tenant_id: "a1000000-0000-4000-8000-000000000001", title: "FORGED", layer: "I",
    storage_key: "forged/x/1", doc_kind: "note", uploaded_by: "b1000000-0000-4000-8000-000000000001", snippet: "attack" }) });
  const body = await r.json().catch(() => ({}));
  check("anon forged INSERT into document rejected", r.status === 401 || r.status === 403 || body.code === "42501", `HTTP ${r.status} code ${body.code ?? "-"}`);
}
// 4. Anonymous INSERT into audit_log (no policy at all) rejected
{
  const r = await rest("audit_log", ANON, { method: "POST", body: JSON.stringify({ action: "forged", detail: "attack" }) });
  check("anon INSERT into audit_log rejected", !r.ok, `HTTP ${r.status}`);
}
// 5. Service role sanity: data actually exists (proves probes 1-2 tested RLS, not an empty DB)
{
  const r = await rest("tenant?select=id", SVC);
  const body = r.ok ? await r.json() : [];
  check("service role sees seeded tenants (>=2)", body.length >= 2, `rows ${body.length}`);
}
// 6. Storage: anonymous listing of the private documents bucket returns nothing
{
  const r = await fetch(`${URL}/storage/v1/object/list/documents`, { method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "" }) });
  const body = await r.json().catch(() => []);
  check("anon cannot list private documents bucket", !r.ok || (Array.isArray(body) && body.length === 0), `HTTP ${r.status}`);
}
console.log(failures === 0 ? "\nALL PROBES PASSED — every attack failed." : `\n${failures} PROBE(S) FAILED — STOP EVERYTHING.`);
process.exit(failures === 0 ? 0 : 1);
