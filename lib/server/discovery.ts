import "server-only";
// Web discovery runs (patch 5 of the 1 November 2026 build). The rules for
// what is asked, kept and proposed are pure, in lib/web-discovery.ts.
//
// One question per call: each is a model call that searches the web, which
// takes 20 to 40 seconds against a 60-second function limit. The page asks
// for the next question until none are left, like Finish the explanations.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { getSearchProfile } from "./search-profile-read";
import { webSearchComplete, webSearchAvailable } from "./llm";
import { usableFacts, FACET_LABEL } from "@/lib/search-profile";
import { searchPhrases } from "@/lib/open-data";
import {
  discoveryAngles, discoverUser, clientFacts, parseLeads, groundLeads, overlayDraft,
  DISCOVER_SYSTEM, SEARCHES_PER_ANGLE, type Angle, type Lead,
} from "@/lib/web-discovery";

export { webSearchAvailable };

export interface DiscoveryRun {
  id: string; angles: Angle[]; done: string[]; found: number; proposed: number;
  searches: number; note: string | null; started_at: string; finished_at: string | null;
}

export interface LeadRow {
  id: string; kind: "opportunity" | "funder"; money_kind: string; title: string; funder: string | null;
  url: string; deadline: string | null; rolling: boolean; amount_text: string | null;
  geography: string | null; eligibility: string | null; why: string | null; quote: string | null;
  grounded: "exact" | "site"; overlay_id: string | null; found_at: string; last_seen_at: string;
  /** The Ground Truth proposal's status. For Granted only; null for a client. */
  review: string | null;
}

/** Plan a run: the questions, from the profile and the Search Profile's own words. */
export async function startDiscovery(tenantId: string, userId: string): Promise<DiscoveryRun> {
  const p = await getEligibilityProfile(tenantId);
  if (!p.org_type || !p.cause_areas.length) {
    throw new Error("Fill in at least the organization type and one cause area before searching the web.");
  }
  const stored = await getSearchProfile(tenantId).catch(() => null);
  const facts = stored ? usableFacts(stored, ["identity", "work"]) : [];
  const identity = facts.find(f => f.facet === "identity")?.text.trim() ?? "";
  const work = facts.filter(f => f.facet === "work").slice(0, 2).map(f => f.text.trim()).join("; ");
  const angles = discoveryAngles(p, identity, work);
  const { data, error } = await db.from("discovery_run").insert({
    tenant_id: tenantId, angles, started_by: userId,
  }).select("*").single();
  if (error || !data) throw new Error("Could not start the web search. Has migration 0074 been applied?");
  return data as unknown as DiscoveryRun;
}

export async function getDiscoveryRun(tenantId: string, runId: string): Promise<DiscoveryRun | null> {
  const { data } = await db.from("discovery_run").select("*").eq("tenant_id", tenantId).eq("id", runId).maybeSingle();
  return (data as unknown as DiscoveryRun | null) ?? null;
}

export async function latestDiscoveryRun(tenantId: string): Promise<DiscoveryRun | null> {
  const { data } = await db.from("discovery_run").select("*").eq("tenant_id", tenantId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data as unknown as DiscoveryRun | null) ?? null;
}

/** Write a lead's Ground Truth proposal, or find the one already filed for that page. */
async function propose(l: Lead, tenantId: string, userId: string | null, topics: string[]): Promise<{ id: string | null; created: boolean }> {
  const draft = overlayDraft(l, topics);
  // tenant-safe: ledger_overlay is For Granted's shared, admin-only record with no tenant_id; looked up by the page's URL.
  const { data: existing } = await db.from("ledger_overlay").select("id").eq("source_url", draft.source_url).limit(1).maybeSingle();
  if (existing) return { id: (existing as { id: string }).id, created: false };
  // tenant-safe: as above; surfaced_for_tenant records which client's search found it.
  const { data, error } = await db.from("ledger_overlay").insert({
    kind: draft.kind, base_id: null, ein: null,
    opportunity_number: draft.kind === "grant" ? draft.source_url.slice(0, 400) : null,
    title: draft.title.slice(0, 300), fields: draft.fields, source_url: draft.source_url,
    provenance: "web_discovery", surfaced_for_tenant: tenantId, status: "proposed",
    // Found by a model and checked only against the search results: the lowest
    // confidence the queue has, until a person reads the page.
    confidence: "low", proposed_by: userId,
  }).select("id").maybeSingle();
  if (error) { console.error("[discovery] proposal not filed", error.message); return { id: null, created: false }; }
  return { id: (data as { id: string } | null)?.id ?? null, created: true };
}

/**
 * Ask the next question of a run, keep what holds up, file proposals.
 * Returns how many questions are left; zero finishes the run.
 */
export async function runDiscoveryPass(
  tenantId: string, runId: string, orgName: string, userId: string | null,
  onProgress?: (detail: string) => void,
): Promise<{ found: number; proposed: number; remaining: number; note: string | null }> {
  const run = await getDiscoveryRun(tenantId, runId);
  if (!run) throw new Error("That web search was not found.");
  const angle = run.angles.find(a => !run.done.includes(a.key));
  if (!angle) {
    if (!run.finished_at) await db.from("discovery_run").update({ finished_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", runId);
    return { found: 0, proposed: 0, remaining: 0, note: null };
  }
  if (!webSearchAvailable()) {
    const note = "Web search is not available in this environment (it needs Bedrock and the AgentCore web search gateway).";
    await db.from("discovery_run").update({ note, finished_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", runId);
    return { found: 0, proposed: 0, remaining: 0, note };
  }

  const p = await getEligibilityProfile(tenantId);
  const stored = await getSearchProfile(tenantId).catch(() => null);
  const profileLines = stored
    ? usableFacts(stored, ["identity", "work", "need", "beneficiaries", "geography", "distinctive"])
        .slice(0, 8).map(f => `${FACET_LABEL[f.facet]}: ${f.text.trim()}`)
    : [];
  const today = new Date().toISOString().slice(0, 10);
  onProgress?.(`searching the web: ${angle.question}`);

  const res = await webSearchComplete({
    system: DISCOVER_SYSTEM,
    user: discoverUser(angle, clientFacts(p, orgName, profileLines), today),
    maxTokens: 3000, temperature: 0.2, maxUses: SEARCHES_PER_ANGLE, budgetMs: 45_000,
  });

  const done = [...run.done, angle.key];
  const remaining = run.angles.filter(a => !done.includes(a.key)).length;
  let leads: Lead[] = [];
  let note: string | null = null;
  if (!res) {
    note = `The search for "${angle.key}" did not answer. The rest of the run carries on.`;
  } else {
    leads = groundLeads(parseLeads(res.text), res.sources.map(s => s.url), angle.kind, today);
    onProgress?.(`${leads.length} kept from ${res.sources.length} pages read`);
  }

  let proposed = 0;
  const topics = searchPhrases(p);
  for (const l of leads) {
    const { data: row, error } = await db.from("discovered_lead").upsert({
      tenant_id: tenantId, run_id: runId, angle: angle.key, kind: l.kind, money_kind: l.money_kind,
      title: l.title, funder: l.funder, url: l.url, url_key: l.url_key, deadline: l.deadline,
      rolling: l.rolling, amount_text: l.amount, geography: l.geography, eligibility: l.eligibility,
      why: l.why, quote: l.quote, grounded: l.grounded, last_seen_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,url_key" }).select("id, overlay_id").maybeSingle();
    if (error || !row) { console.error("[discovery] lead not saved", error?.message); continue; }
    const r = row as { id: string; overlay_id: string | null };
    if (r.overlay_id) continue;
    const prop = await propose(l, tenantId, userId, topics);
    if (prop.created) proposed += 1;
    if (prop.id) await db.from("discovered_lead").update({ overlay_id: prop.id }).eq("tenant_id", tenantId).eq("id", r.id);
  }

  await db.from("discovery_run").update({
    done, found: run.found + leads.length, proposed: run.proposed + proposed,
    searches: run.searches + (res?.searches ?? 0),
    note: note ?? run.note,
    finished_at: remaining ? null : new Date().toISOString(),
  }).eq("tenant_id", tenantId).eq("id", runId);

  return { found: leads.length, proposed, remaining, note };
}

/**
 * What the web search has found for this client, newest first. A client sees
 * only rows whose exact page the search returned, and nothing past its
 * deadline; For Granted sees everything, with the review status.
 */
export async function getLeads(tenantId: string, forClient: boolean): Promise<LeadRow[]> {
  const { data, error } = await db.from("discovered_lead").select("*")
    .eq("tenant_id", tenantId).order("found_at", { ascending: false }).limit(300);
  if (error) {
    // Before 0074 the table does not exist; the section simply stays empty.
    console.error("[discovery] leads not read", error.message);
    return [];
  }
  const today = new Date().toISOString().slice(0, 10);
  let rows = ((data ?? []) as unknown as Omit<LeadRow, "review">[])
    .filter(r => !r.deadline || r.deadline >= today);
  if (forClient) rows = rows.filter(r => r.grounded === "exact");
  let status = new Map<string, string>();
  if (!forClient) {
    const ids = [...new Set(rows.map(r => r.overlay_id).filter(Boolean) as string[])];
    if (ids.length) {
      // tenant-safe: admin-only read of For Granted's shared review queue, by the ids this client's leads point at.
      const { data: ov } = await db.from("ledger_overlay").select("id, status").in("id", ids);
      status = new Map(((ov ?? []) as { id: string; status: string }[]).map(o => [o.id, o.status]));
    }
  }
  return rows.map(r => ({ ...r, review: forClient ? null : (r.overlay_id ? status.get(r.overlay_id) ?? null : null) }));
}
