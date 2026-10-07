import "server-only";
// Inven(s)tory Analysis, Phase D: the switch-over, on the server.
//
// A plain server module, not "use server": every function takes a tenant id.
// The admin actions in analysis-switch-actions.ts take the tenant from the
// session and call these.
//
// applyAnalysis() is the whole of "the analysis is the source": it writes
// readiness, re-merges the Card Library from the analysis and writes the
// search profile, all from what the analysis stored, with no model call. It
// runs at the switch, after every analysis run, when a refusal changes, and
// when anyone presses one of the old buttons (Run Readiness Check, Re-merge,
// rebuild the profile) for a switched client. Every one of them is free.
import { db } from "./db";
import { analysedDocs } from "./analysis-client-read";
import { remergeLibrary, planLibraryMerge, type MergeSummary } from "./card-extract";
import { describeMerge } from "./card-build";
import { onAnalysis, switchStatus } from "./analysis-source";
import { pendingReading } from "./analysis-extract";
import { getProfileEdits } from "./search-profile-read";
import { checklistFor } from "@/lib/checklist";
import { deriveReadiness, deriveSearchFacts, readinessScore, type ItemState } from "@/lib/analysis-derive";
import { coverageFromDerived, describeLibraryChange, type LibraryChange } from "@/lib/analysis-switch";
import { mergeFacts, assessProfile, documentFingerprint, factId, type ProfileFact } from "@/lib/search-profile";

async function orgTypeOf(tenantId: string): Promise<string | null> {
  const { data } = await db.from("eligibility_profile").select("org_type").eq("tenant_id", tenantId).maybeSingle();
  return (data?.org_type as string | null) ?? null;
}

/** Readiness from the analysis, in eligibility_gap's own shape, with its score. */
async function derivedReadiness(tenantId: string) {
  const [{ docs }, orgType] = await Promise.all([analysedDocs(tenantId), orgTypeOf(tenantId)]);
  const items = deriveReadiness(orgType, docs);
  const state = new Map(items.map(i => [i.key, i.state]));
  const pct = readinessScore(checklistFor(orgType), k => (state.get(k) ?? "missing") as ItemState);
  return { docs, coverage: coverageFromDerived(items), pct };
}

/** The search profile from the analysis: the same selection rule (mergeFacts) as the old profile. */
async function derivedProfile(tenantId: string, docs: Awaited<ReturnType<typeof analysedDocs>>["docs"]) {
  const facts = mergeFacts(deriveSearchFacts(docs));
  const layers = [...new Set(facts.map(f => f.layer).filter(Boolean))] as ("I" | "II" | "III")[];
  return { facts, layers, documentCount: docs.filter(d => d.cards.length || d.facts.length).length };
}

/** Write readiness only (free). Run Readiness Check, for a switched client. */
export async function applyReadiness(tenantId: string): Promise<{ pct: number }> {
  const r = await derivedReadiness(tenantId);
  const { error } = await db.from("eligibility_gap").upsert(
    { tenant_id: tenantId, content_gaps: r.coverage, computed_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) throw new Error(`could not save readiness: ${error.message}`);
  return { pct: r.pct };
}

/** Write the search profile only (free). Rebuild the profile, for a switched client. */
export async function applySearchProfile(tenantId: string, userId: string | null): Promise<{ facts: number; note: string }> {
  const { docs } = await analysedDocs(tenantId);
  const p = await derivedProfile(tenantId, docs);
  const generatedAt = new Date().toISOString();
  const health = assessProfile({ facts: p.facts, generatedAt, documentCount: p.documentCount, layers: p.layers });
  const { data: ready } = await db.from("document").select("id").eq("tenant_id", tenantId).eq("status", "ready");
  const { error } = await db.from("search_profile").upsert({
    tenant_id: tenantId, facts: p.facts, document_count: p.documentCount, layers: p.layers,
    doc_fingerprint: documentFingerprint((ready ?? []) as { id: string }[]),
    note: health.note, generated_at: generatedAt, generated_by: userId,
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`could not save the search profile: ${error.message}`);
  return { facts: p.facts.length, note: health.note };
}

export interface ApplyResult { readinessPct: number; merge: MergeSummary; profileFacts: number; text: string }

/** Make the analysis the source of everything it replaces, now. No model call. */
export async function applyAnalysis(tenantId: string, userId: string | null): Promise<ApplyResult> {
  const { pct } = await applyReadiness(tenantId);
  const merge = await remergeLibrary(tenantId, "analysis");
  const profile = await applySearchProfile(tenantId, userId);
  return {
    readinessPct: pct, merge, profileFacts: profile.facts,
    text: `Readiness ${pct}%. Card Library: ${describeMerge(merge)} Search profile: ${profile.facts} fact(s).`,
  };
}

/** applyAnalysis for a switched client; nothing for any other. Never throws: callers have already done their own work. */
export async function refreshIfOnAnalysis(tenantId: string, userId: string | null): Promise<ApplyResult | null> {
  try {
    if (!(await onAnalysis(tenantId))) return null;
    return await applyAnalysis(tenantId, userId);
  } catch (e) {
    console.error("[analysis] could not refresh from the analysis", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface SwitchPreview {
  readiness: { before: number | null; after: number; changed: { key: string; label: string; before: string; after: string }[] };
  library: LibraryChange;
  profile: { before: number; after: number; editsKept: number; editsLost: number };
  pendingDocs: number;
  analysedDocs: number;
}

/** What switching this client would change, worked out and not written. */
export async function previewSwitch(tenantId: string): Promise<SwitchPreview> {
  const orgType = await orgTypeOf(tenantId);
  const [r, { data: gapRow }, { plan, cards }, { data: profRow }, edits, pending, { data: placed }, { data: verified }, { data: edited }] = await Promise.all([
    derivedReadiness(tenantId),
    db.from("eligibility_gap").select("content_gaps").eq("tenant_id", tenantId).maybeSingle(),
    planLibraryMerge(tenantId, "analysis"),
    db.from("search_profile").select("facts").eq("tenant_id", tenantId).maybeSingle(),
    getProfileEdits(tenantId).catch(() => []),
    pendingReading(tenantId),
    db.from("section_block").select("card_id").eq("tenant_id", tenantId).not("card_id", "is", null),
    db.from("story_card").select("id").eq("tenant_id", tenantId).eq("status", "verified"),
    db.from("story_card").select("id").eq("tenant_id", tenantId).eq("statement_origin", "human"),
  ]);
  const items = checklistFor(orgType);
  const before = (gapRow?.content_gaps ?? null) as Record<string, { state?: string } | string> | null;
  const stateBefore = (k: string): ItemState => {
    const v = before?.[k];
    return ((typeof v === "string" ? v : v?.state) ?? "missing") as ItemState;
  };
  const changed = items
    .filter(i => stateBefore(i.key) !== r.coverage[i.key]?.state)
    .map(i => ({ key: i.key, label: i.label, before: stateBefore(i.key), after: r.coverage[i.key]?.state ?? "missing" }));

  const p = await derivedProfile(tenantId, r.docs);
  const newIds = new Set(p.facts.map(f => factId(f)));
  const lineEdits = edits.filter(e => e.kind !== "add");
  const editsKept = lineEdits.filter(e => newIds.has(e.factId)).length;

  return {
    readiness: { before: before ? readinessScore(items, stateBefore) : null, after: r.pct, changed },
    library: describeLibraryChange(plan, cards, {
      placed: new Set(((placed ?? []) as { card_id: string }[]).map(x => x.card_id)),
      verified: new Set(((verified ?? []) as { id: string }[]).map(x => x.id)),
      edited: new Set(((edited ?? []) as { id: string }[]).map(x => x.id)),
    }),
    profile: {
      before: ((profRow?.facts ?? []) as ProfileFact[]).length, after: p.facts.length,
      editsKept, editsLost: lineEdits.length - editsKept,
    },
    pendingDocs: pending.docs,
    analysedDocs: r.docs.length,
  };
}

/** Switch on: keep what the client had, record the gate, then make the analysis the source. */
export async function switchOn(tenantId: string, userId: string, gateSnapshot: Record<string, unknown> | null): Promise<ApplyResult> {
  const [{ data: gap }, { data: prof }, { data: state }] = await Promise.all([
    db.from("eligibility_gap").select("content_gaps, computed_at").eq("tenant_id", tenantId).maybeSingle(),
    db.from("search_profile").select("*").eq("tenant_id", tenantId).maybeSingle(),
    db.from("analysis_client_state").select("pre_switch").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  // Keep the first snapshot: switching on, back and on again must still restore what the old reads made.
  const pre = (state as { pre_switch: unknown } | null)?.pre_switch ?? { eligibility_gap: gap ?? null, search_profile: prof ?? null, taken_at: new Date().toISOString() };
  const { error } = await db.from("analysis_client_state").upsert({
    tenant_id: tenantId, switched_at: new Date().toISOString(), switched_by: userId, switched_off_at: null,
    pre_switch: pre, ...(gateSnapshot ? { gate_snapshot: gateSnapshot } : {}),
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`could not switch: ${error.message}`);
  return applyAnalysis(tenantId, userId);
}

/** Switch back: the old reads are the source again, exactly as they were before the switch. */
export async function switchOff(tenantId: string): Promise<MergeSummary> {
  const { data: state, error: sErr } = await db.from("analysis_client_state").select("pre_switch").eq("tenant_id", tenantId).maybeSingle();
  if (sErr) throw new Error(`could not read the switch: ${sErr.message}`);
  const pre = (state as { pre_switch: { eligibility_gap: Record<string, unknown> | null; search_profile: Record<string, unknown> | null } | null } | null)?.pre_switch;
  const { error } = await db.from("analysis_client_state").upsert({
    tenant_id: tenantId, switched_at: null, switched_off_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) throw new Error(`could not switch back: ${error.message}`);
  if (pre?.eligibility_gap) {
    await db.from("eligibility_gap").upsert({ ...pre.eligibility_gap, tenant_id: tenantId }, { onConflict: "tenant_id" });
  } else {
    await db.from("eligibility_gap").delete().eq("tenant_id", tenantId);
  }
  if (pre?.search_profile) {
    await db.from("search_profile").upsert({ ...pre.search_profile, tenant_id: tenantId }, { onConflict: "tenant_id" });
  } else {
    await db.from("search_profile").delete().eq("tenant_id", tenantId);
  }
  return remergeLibrary(tenantId, "cards");
}

export { switchStatus };
