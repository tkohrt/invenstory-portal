import "server-only";
// Reading a client's source choices, and whether each source can run here
// (patch 11 of the 1 November 2026 build). Rules: lib/sources.ts.
import { db } from "./db";
import { webSearchAvailable } from "./llm";
import { getEligibilityProfile } from "./eligibility";
import {
  isSourceId, isSourceMode, resolveSources, lastRunBySource,
  type Availability, type SourceId, type SourceSetting, type SourceState, type SourceRun, type RunCall,
} from "@/lib/sources";

/** This client's stored choices. Empty before 0076, so every source reads as Automatic. */
export async function getSourceSettings(tenantId: string): Promise<Partial<Record<SourceId, SourceSetting>>> {
  const { data, error } = await db.from("match_source_setting")
    .select("source, mode, locked, set_by_role").eq("tenant_id", tenantId);
  if (error) { console.error("[sources] settings not read", error.message); return {}; }
  const out: Partial<Record<SourceId, SourceSetting>> = {};
  for (const r of (data ?? []) as { source: string; mode: string; locked: boolean; set_by_role: string }[]) {
    if (!isSourceId(r.source) || !isSourceMode(r.mode)) continue;
    out[r.source] = { mode: r.mode, locked: !!r.locked, setByRole: r.set_by_role === "admin" ? "admin" : "client" };
  }
  return out;
}

/**
 * Sources that cannot run in this environment, for anyone. OPEN_SOURCES_DISABLED
 * (a comma-separated list of source ids) switches a source off for every client,
 * for an outage or an expired key, without a deploy of code.
 */
export function sourceAvailability(viewer: "admin" | "client" = "admin"): Availability {
  const off = new Set((process.env.OPEN_SOURCES_DISABLED ?? "").split(",").map(x => x.trim()).filter(Boolean));
  const a: Availability = {};
  // A client reads a plain sentence; For Granted reads what to fix.
  const notYet = "Not available yet. Your For Granted team is setting it up.";
  for (const id of off) if (isSourceId(id) && id !== "ledger") a[id] = viewer === "admin" ? "Switched off for every client (OPEN_SOURCES_DISABLED)." : "Paused for now by For Granted.";
  if (!a.iati && !process.env.IATI_API_KEY) a.iati = viewer === "admin" ? "Not set up yet: it needs IATI_API_KEY in Vercel." : notYet;
  if (!a.web && !webSearchAvailable()) a.web = viewer === "admin" ? "Not available here: it needs AGENTCORE_GATEWAY_URL (Web Search on Bedrock AgentCore) in Vercel." : notYet;
  return a;
}

/** Every source for this client, resolved. Never throws: an unread profile resolves as empty. */
export async function getSourceStates(tenantId: string, viewer: "admin" | "client"): Promise<SourceState[]> {
  const [p, settings] = await Promise.all([
    getEligibilityProfile(tenantId),
    getSourceSettings(tenantId),
  ]);
  return resolveSources(p, settings, sourceAvailability(viewer), viewer);
}

/**
 * What each source did on the last FINISHED match run, with no query text. A
 * run's row is written when it starts, with the planned queries only, and
 * filled in at the end; a row whose queries carry no outcome is a run still
 * going, or one that stopped, so it is skipped rather than read as "nothing found".
 */
export async function getLastRunBySource(tenantId: string): Promise<{ ranAt: string | null; bySource: Partial<Record<SourceId, SourceRun>> }> {
  const { data, error } = await db.from("match_run")
    .select("ran_at, queries").eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false }).limit(5);
  if (error || !data) return { ranAt: null, bySource: {} };
  const row = (data as { ran_at: string | null; queries: RunCall[] | null }[])
    .find(r => (r.queries ?? []).some(q => typeof q.ok === "boolean"));
  if (!row) return { ranAt: null, bySource: {} };
  return { ranAt: row.ran_at ?? null, bySource: lastRunBySource(row.queries ?? []) };
}

/** Is the web search on for this client? The discover route asks before a new run. */
export async function webSourceOn(tenantId: string): Promise<boolean> {
  const states = await getSourceStates(tenantId, "admin").catch(() => null);
  return states?.find(s => s.id === "web")?.on ?? true;
}
