import "server-only";
// Inven(s)tory Analysis, Phase C: everything the client's Analyze page shows.
//
// The analysis tables are admin-only under RLS, so this reads through the
// service client, always for the session's own tenant, and returns only what a
// client may see: readiness and what is missing, how many cards were found by
// kind, the eligibility answers waiting to be confirmed (each with the line it
// came from), what has opened up, and whether the button is available. No rank
// scores, refusals, duplicate flags or review state: those stay For Granted's.
import { db } from "./db";
import { getEligibilityProfile } from "./eligibility";
import { pendingReading } from "./analysis-extract";
import { activeRefusals } from "./refusals";
import { dropRefusedCards } from "@/lib/refusal";
import { checklistFor } from "@/lib/checklist";
import { previewLibrary, type AnalysisCard, type AnalysisFact } from "@/lib/analysis";
import {
  deriveReadiness, deriveEligibility, readinessScore, essentialsAtLeastThin,
  type AnalysedDoc, type ItemState,
} from "@/lib/analysis-derive";
import { openSuggestions, unlocks, type OpenSuggestion, type SuggestionDecision } from "@/lib/analysis-client";
import { decideClientRun, type CapDecision, type UsageRow } from "@/lib/analysis-cap";
import type { SpeakerRoster } from "@/lib/transcript-speakers";

export interface ClientAnalysis {
  analysed: number;
  documents: number;
  readiness: {
    pct: number;
    items: { key: string; label: string; gap: string; tier: string; state: ItemState }[];
  };
  cardsByKind: { label: string; count: number }[];
  cardTotal: number;
  suggestions: OpenSuggestion[];
  eligibilityConfirmedAt: string | null;
  unlock: ReturnType<typeof unlocks>;
  cap: CapDecision;
  pendingRequest: { id: string; at: string } | null;
  lastDecided: { status: "approved" | "declined"; at: string } | null;
}

/** The client's own presses, for the cap. For Granted's runs are never recorded. */
export async function clientUsage(tenantId: string): Promise<UsageRow[]> {
  const since = new Date(Date.now() - 32 * 24 * 3600_000).toISOString();
  // A run For Granted approved past the cap does not count against it.
  const { data, error } = await db.from("analysis_usage").select("created_at, pending_chars")
    .eq("tenant_id", tenantId).gte("created_at", since).is("via_request", null);
  if (error) throw new Error(`could not read analysis usage: ${error.message}`);
  return ((data ?? []) as { created_at: string; pending_chars: number }[]).map(r => ({ at: r.created_at, pendingChars: r.pending_chars }));
}

/** An approved request not yet used by a run: it lets one press past the cap. */
export async function unusedApproval(tenantId: string): Promise<string | null> {
  const [{ data: approved }, { data: used }] = await Promise.all([
    db.from("analysis_request").select("id").eq("tenant_id", tenantId).eq("status", "approved")
      .order("decided_at", { ascending: false }).limit(5),
    db.from("analysis_usage").select("via_request").eq("tenant_id", tenantId).not("via_request", "is", null),
  ]);
  const usedIds = new Set(((used ?? []) as { via_request: string }[]).map(r => r.via_request));
  return ((approved ?? []) as { id: string }[]).find(r => !usedIds.has(r.id))?.id ?? null;
}

/** The documents the analysis has read, in the shape the derivations take. */
export async function analysedDocs(tenantId: string): Promise<{ docs: AnalysedDoc[]; ready: number }> {
  const [{ data: rows, error: rErr }, { data: docRows, error: dErr }] = await Promise.all([
    db.from("analysis_doc").select("document_id, doc_type, doc_type_proven, doc_type_quote, cards, facts").eq("tenant_id", tenantId),
    db.from("document").select("id, title, layer, speaker_roster").eq("tenant_id", tenantId).eq("status", "ready"),
  ]);
  if (rErr) throw new Error(`analysis read failed: ${rErr.message}`);
  if (dErr) throw new Error(`document read failed: ${dErr.message}`);
  const byId = new Map(((docRows ?? []) as { id: string; title: string; layer: string | null; speaker_roster: SpeakerRoster | null }[])
    .map(d => [d.id, d]));
  const docs = ((rows ?? []) as Record<string, unknown>[])
    .filter(r => byId.has(r.document_id as string))
    .map(r => {
      const d = byId.get(r.document_id as string)!;
      return {
        id: d.id, title: d.title, layer: d.layer,
        docType: (r.doc_type as string | null) ?? null,
        docTypeProven: !!r.doc_type_proven,
        docTypeQuote: (r.doc_type_quote as string | null) ?? null,
        cards: (r.cards as AnalysisCard[]) ?? [],
        facts: (r.facts as AnalysisFact[]) ?? [],
        roster: d.speaker_roster ?? null,
      };
    });
  // Cards resting on a quote For Granted refused never count (decisions 19 and 31).
  return { docs: dropRefusedCards(docs, await activeRefusals(tenantId)), ready: byId.size };
}

export async function getClientAnalysis(tenantId: string): Promise<ClientAnalysis> {
  const [{ docs, ready }, profile, { data: decRows }, { data: state }, usage, pending, approval, { data: reqRows }] = await Promise.all([
    analysedDocs(tenantId),
    getEligibilityProfile(tenantId),
    db.from("analysis_suggestion_decision").select("field, value_key, decision").eq("tenant_id", tenantId),
    db.from("analysis_client_state").select("eligibility_confirmed_at").eq("tenant_id", tenantId).maybeSingle(),
    clientUsage(tenantId),
    pendingReading(tenantId),
    unusedApproval(tenantId),
    db.from("analysis_request").select("id, status, created_at, decided_at").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(1),
  ]);

  const orgType = profile.org_type;
  const derived = deriveReadiness(orgType, docs);
  const stateOf = new Map(derived.map(d => [d.key, d.state]));
  const st = (k: string): ItemState => stateOf.get(k) ?? "missing";
  const checklist = checklistFor(orgType);

  const library = previewLibrary(docs.map(d => ({ documentId: d.id, cards: d.cards })));
  const kinds = new Map<string, number>();
  for (const c of library) kinds.set(c.kindLabel, (kinds.get(c.kindLabel) ?? 0) + 1);

  const decisions: SuggestionDecision[] = ((decRows ?? []) as { field: string; value_key: string; decision: "confirmed" | "rejected" }[])
    .map(r => ({ field: r.field, valueKey: r.value_key, decision: r.decision }));
  const suggestions = openSuggestions(deriveEligibility(docs, profile), decisions);
  const confirmedAt = (state as { eligibility_confirmed_at: string | null } | null)?.eligibility_confirmed_at ?? null;

  const last = ((reqRows ?? []) as { id: string; status: string; created_at: string; decided_at: string | null }[])[0];
  return {
    analysed: docs.length,
    documents: ready,
    readiness: {
      pct: readinessScore(checklist, st),
      items: checklist.map(i => ({ key: i.key, label: i.label, gap: i.gap, tier: i.tier, state: st(i.key) })),
    },
    cardsByKind: [...kinds].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    cardTotal: library.length,
    suggestions,
    // A new suggestion after confirming (a new document) re-opens the step.
    eligibilityConfirmedAt: suggestions.length ? null : confirmedAt,
    unlock: unlocks({
      analysed: docs.length > 0,
      eligibilityConfirmed: !!confirmedAt && !suggestions.length,
      essentialsThin: essentialsAtLeastThin(orgType, st),
    }),
    cap: decideClientRun({ now: new Date(), usage, pendingDocs: pending.docs, pendingChars: pending.chars, approvedRequest: !!approval }),
    pendingRequest: last?.status === "pending" ? { id: last.id, at: last.created_at } : null,
    lastDecided: last && last.status !== "pending" && last.decided_at
      ? { status: last.status as "approved" | "declined", at: last.decided_at } : null,
  };
}

/** For Granted's view: every pending request for this client. */
export async function pendingRequests(tenantId: string) {
  const { data, error } = await db.from("analysis_request")
    .select("id, note, created_at, requested_by, app_user:requested_by(full_name)")
    .eq("tenant_id", tenantId).eq("status", "pending").order("created_at");
  if (error) throw new Error(`could not read requests: ${error.message}`);
  return ((data ?? []) as unknown as { id: string; note: string | null; created_at: string; app_user: { full_name: string } | null }[])
    .map(r => ({ id: r.id, note: r.note, at: r.created_at, by: r.app_user?.full_name ?? "The client" }));
}
