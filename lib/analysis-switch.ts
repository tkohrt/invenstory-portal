// Inven(s)tory Analysis, Phase D: switching a client over to the analysis.
//
// Once a client is switched, the analysis is the source of three things that
// separate reads produced before: readiness (eligibility_gap.content_gaps), the
// Card Library (merged from analysis_doc.cards instead of story_card_doc), and
// the search profile (search_profile.facts). All three are worked out in code
// from what the analysis stored, so keeping them current costs no model call.
//
// The gate (decision 29): RE-Assist is the proving client. Its own switch needs
// its card review and its Compare tab to pass, live. Every other client may
// switch once RE-Assist has, with no review of its own, and a client created
// after RE-Assist's switch starts on the analysis without being switched by
// hand. Switch back is always possible and restores what the client had.
//
// Pure, so the page, the server and the tests agree.
import type { DerivedItem } from "./analysis-derive";
import type { MergePlan, MergeCard } from "./card-merge";

/** RE-Assist, whose review and Compare prove the reader for every client (decision 29). */
export const PROVING_TENANT_ID = "7c9d621b-409a-4422-a8a4-78d09b2c5885";

export interface SwitchRow {
  switched_at: string | null;
  switched_off_at: string | null;
}

/**
 * Is this client on the analysis? Switched by hand, or created after the proof
 * and never switched back. `proofAt` is when RE-Assist switched, or null.
 */
export function isOnAnalysis(row: SwitchRow | null, tenantCreatedAt: string | null, proofAt: string | null): boolean {
  if (row?.switched_at) return true;
  if (row?.switched_off_at) return false;
  if (!proofAt || !tenantCreatedAt) return false;
  return new Date(tenantCreatedAt).getTime() > new Date(proofAt).getTime();
}

export interface GateInput {
  tenantId: string;
  /** Ready documents still waiting to be analysed (new, changed, or read under older rules). */
  pendingDocs: number;
  /** Ready documents the analysis has read. */
  analysedDocs: number;
  /** When RE-Assist switched, or null if it has not. */
  proofAt: string | null;
  /** RE-Assist's own gates, needed only for RE-Assist's switch. */
  review?: { passes: boolean; reviewed: number; target: number; supportedPct: number };
  compare?: { passes: boolean; disagreements: number; judged: number; toFix: number };
}

export interface GateResult { allowed: boolean; reasons: string[] }

/** May this client be switched now? Each reason is a sentence for the page. */
export function switchGate(g: GateInput): GateResult {
  const reasons: string[] = [];
  if (g.analysedDocs === 0) reasons.push("Nothing has been analysed yet. Run the analysis first.");
  if (g.pendingDocs > 0) {
    reasons.push(`${g.pendingDocs} document${g.pendingDocs === 1 ? " is" : "s are"} still waiting to be analysed. `
      + "Read them first (Check for changes), so readiness counts everything.");
  }
  if (g.tenantId === PROVING_TENANT_ID) {
    if (!g.review?.passes) {
      reasons.push(g.review
        ? `The card review has not passed yet: ${g.review.reviewed} of ${g.review.target} reviewed, ${g.review.supportedPct}% fully supported (at least 90%, with every pair decided).`
        : "The card review could not be read.");
    }
    if (!g.compare?.passes) {
      reasons.push(g.compare
        ? `Compare has not passed yet: ${g.compare.judged} of ${g.compare.disagreements} disagreements judged`
          + (g.compare.toFix ? `, ${g.compare.toFix} judged as the new read being wrong (fix those first).` : ".")
        : "The Compare tab could not be worked out.");
    }
  } else if (!g.proofAt) {
    reasons.push("RE-Assist has not been switched yet. Its card review and Compare prove the analysis for every client (decision 29); switch RE-Assist first.");
  }
  return { allowed: reasons.length === 0, reasons };
}

export interface CoverageItem { state: "covered" | "thin" | "missing"; sources: { id: string; title: string; quote?: string }[] }

/** Derived readiness in the exact shape eligibility_gap.content_gaps has always held. */
export function coverageFromDerived(items: DerivedItem[]): Record<string, CoverageItem> {
  const out: Record<string, CoverageItem> = {};
  for (const i of items) {
    const seen = new Set<string>();
    const sources: CoverageItem["sources"] = [];
    if (i.state !== "missing") {
      for (const s of i.sources) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        sources.push(s.quote ? { id: s.id, title: s.title, quote: s.quote } : { id: s.id, title: s.title });
      }
    }
    out[i.key] = { state: i.state, sources };
  }
  return out;
}

export interface LibraryChange {
  created: number;
  kept: number;
  revived: number;
  retired: number;
  /** Cards the switch would retire that a person has put to use: placed in a draft, verified or edited. */
  retiringInUse: { id: string; kind: string; statement: string; why: string[] }[];
  /**
   * Cards in use the analysis does not find, kept live on the evidence they
   * already have rather than retired (lib/card-merge.ts, inUse).
   */
  keptOnOldEvidence: { id: string; kind: string; statement: string; why: string[] }[];
}

/**
 * What a merge plan would do to the library, for the preview. `cards` is the
 * library now; `placed` the cards in any draft; `verified` and `edited` the
 * cards a person has verified or reworded.
 */
export function describeLibraryChange(
  plan: MergePlan, cards: MergeCard[], use: { placed: Set<string>; verified: Set<string>; edited: Set<string> },
): LibraryChange {
  const byId = new Map(cards.map(c => [c.id, c]));
  const why = (id: string) => [use.placed.has(id) ? "placed in a draft" : null, use.verified.has(id) ? "verified" : null, use.edited.has(id) ? "edited" : null]
    .filter((x): x is string => !!x);
  const found = new Set(plan.evidence.map(e => e.target));
  const retiring = plan.update.filter(u => u.patch.status === "retired" && byId.get(u.id)?.status !== "retired").map(u => byId.get(u.id)!);
  const liveBefore = cards.filter(c => c.status !== "retired").length;
  const retiringInUse = retiring
    .map(c => ({ id: c.id, kind: c.kind, statement: c.statement, why: why(c.id) }))
    .filter(c => c.why.length);
  const keptOnOldEvidence = cards
    .filter(c => c.status !== "retired" && !found.has(c.id) && why(c.id).length && !retiring.includes(c))
    .map(c => ({ id: c.id, kind: c.kind, statement: c.statement, why: why(c.id) }));
  return {
    created: plan.summary.created,
    kept: liveBefore - retiring.length,
    revived: plan.summary.revived,
    retired: retiring.length,
    retiringInUse,
    keptOnOldEvidence,
  };
}

export type ArrivalPlan = "not_on_analysis" | "nothing_new" | "deferred" | "join" | "start";

/**
 * Read on upload (Phase D patch 4): what to do when a document becomes ready.
 * A client's own uploads keep the existing guard of `uploadReadsPerDay` reads a
 * day (decision 23); For Granted's are never held. A run already going reads
 * the document itself.
 */
export function arrivalPlan(i: {
  onAnalysis: boolean; pendingDocs: number; actor: "client" | "admin";
  readsToday: number; uploadReadsPerDay: number; running: boolean;
}): ArrivalPlan {
  if (!i.onAnalysis) return "not_on_analysis";
  if (i.pendingDocs <= 0) return "nothing_new";
  if (i.actor === "client" && i.readsToday >= i.uploadReadsPerDay) return "deferred";
  return i.running ? "join" : "start";
}
