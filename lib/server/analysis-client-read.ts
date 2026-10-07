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
import { decideClientRun, type CapDecision } from "@/lib/analysis-cap";
import { checkAllowance, pendingAllowanceRequest } from "./allowance";
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
  /** Whether the button is available: something new to read, within the monthly AI allowance (Phase D). */
  cap: CapDecision;
  /** A request for more allowance is already with For Granted. */
  allowanceRequested: boolean;
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
  const [{ docs, ready }, profile, { data: decRows }, { data: state }, pending, allowance, requested] = await Promise.all([
    analysedDocs(tenantId),
    getEligibilityProfile(tenantId),
    db.from("analysis_suggestion_decision").select("field, value_key, decision").eq("tenant_id", tenantId),
    db.from("analysis_client_state").select("eligibility_confirmed_at").eq("tenant_id", tenantId).maybeSingle(),
    pendingReading(tenantId),
    // The client's allowance, also when For Granted is looking at the client's page.
    checkAllowance("client", tenantId, { kind: "build" }),
    pendingAllowanceRequest(tenantId).catch(() => false),
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
    cap: decideClientRun({ pendingDocs: pending.docs, pendingChars: pending.chars, allowance }),
    allowanceRequested: requested,
  };
}
