import "server-only";
// Inven(s)tory Analysis, Phase B: the comparison, for the admin page.
//
// Reads what Phase A stored (analysis_doc), works out readiness, eligibility
// suggestions and the search profile from it in code (lib/analysis-derive.ts),
// and sets each beside what the portal uses today. No model call, no write:
// opening the page is free, and nothing a client sees changes.
//
// Through userClient, so every read runs under RLS as the signed-in admin, and
// every query names the tenant, because an admin's RLS sees every client.
import { userClient } from "./supabase";
import { getContentCoverage } from "./gap-agent";
import { getEligibilityProfile } from "./eligibility";
import { getSearchProfile } from "./search-profile-read";
import { activeRefusals } from "./refusals";
import { dropRefusedCards } from "@/lib/refusal";
import { checklistFor } from "@/lib/checklist";
import {
  deriveReadiness, deriveEligibility, deriveSearchFacts, readinessScore, essentialsAtLeastThin,
  compareReadiness, comparisonGate,
  type AnalysedDoc, type DerivedItem, type ItemState, type ReadinessRow, type Suggestion, type Verdict,
} from "@/lib/analysis-derive";
import { FACETS, FACET_LABEL, type Facet, type ProfileFact } from "@/lib/search-profile";
import type { AnalysisCard, AnalysisFact } from "@/lib/analysis";
import type { SpeakerRoster } from "@/lib/transcript-speakers";

export interface ComparisonData {
  analysed: number;
  orgType: string | null;
  readiness: {
    rows: (ReadinessRow & {
      derivedSources: DerivedItem["sources"]; derivedWhy: string;
      currentSources: { id: string; title: string; quote?: string }[];
      note: string | null;
    })[];
    currentPct: number; derivedPct: number; currentComputedAt: string | null;
    gate: ReturnType<typeof comparisonGate>;
    unlock: { current: boolean; derived: boolean };
  };
  eligibility: (Suggestion & { verdict: Verdict | null; note: string | null })[];
  search: {
    currentAt: string | null;
    facets: { facet: Facet; label: string; current: ProfileFact[]; derived: ProfileFact[] }[];
  };
}

export async function getAnalysisComparison(tenantId: string): Promise<ComparisonData> {
  const s = await userClient();
  const [{ data: readRows, error: rErr }, { data: docRows, error: dErr }, { data: vRows }, profile, coverage, search] = await Promise.all([
    s.from("analysis_doc").select("document_id, doc_type, doc_type_proven, doc_type_quote, cards, facts, content_hash").eq("tenant_id", tenantId),
    s.from("document").select("id, title, layer, speaker_roster").eq("tenant_id", tenantId).eq("status", "ready"),
    s.from("analysis_verdict").select("area, item_key, verdict, old_state, new_state, note").eq("tenant_id", tenantId),
    getEligibilityProfile(tenantId),
    getContentCoverage(tenantId),
    getSearchProfile(tenantId).catch(() => null),
  ]);
  if (rErr) throw new Error(`analysis read failed: ${rErr.message}`);
  if (dErr) throw new Error(`document read failed: ${dErr.message}`);

  const docById = new Map(((docRows ?? []) as { id: string; title: string; layer: string | null; speaker_roster: SpeakerRoster | null }[])
    .map(d => [d.id, d]));
  // Only documents still ready count, as everywhere else.
  const docs: AnalysedDoc[] = ((readRows ?? []) as Record<string, unknown>[])
    .filter(r => docById.has(r.document_id as string))
    .map(r => {
      const d = docById.get(r.document_id as string)!;
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

  const orgType = profile.org_type;
  const items = checklistFor(orgType);
  // The analysis as it would go live: without cards resting on a quote For
  // Granted refused (decisions 19 and 31).
  const live = dropRefusedCards(docs, await activeRefusals(tenantId));
  const derived = deriveReadiness(orgType, live);
  const derivedBy = new Map(derived.map(x => [x.key, x]));
  const current = (key: string): ItemState => (coverage.cov[key]?.state ?? "missing") as ItemState;
  const derivedState = (key: string): ItemState => derivedBy.get(key)?.state ?? "missing";

  type V = { area: string; item_key: string; verdict: Verdict; old_state: string; new_state: string; note: string | null };
  const verdicts = (vRows ?? []) as V[];
  const readinessVerdicts = new Map(verdicts.filter(v => v.area === "readiness")
    .map(v => [v.item_key, { verdict: v.verdict, oldState: v.old_state, newState: v.new_state }]));
  const notes = new Map(verdicts.map(v => [`${v.area}|${v.item_key}`, v.note]));

  const rows = compareReadiness(orgType, current, derived, readinessVerdicts).map(r => ({
    ...r,
    derivedSources: derivedBy.get(r.key)?.sources ?? [],
    derivedWhy: derivedBy.get(r.key)?.why ?? "",
    currentSources: coverage.cov[r.key]?.sources ?? [],
    note: notes.get(`readiness|${r.key}`) ?? null,
  }));

  const eligibility = deriveEligibility(live, profile).map(sug => {
    const v = verdicts.find(x => x.area === "eligibility" && x.item_key === sug.field);
    const oldState = sug.current.join(", ");
    const newState = sug.values.map(x => x.display).join(", ");
    return {
      ...sug,
      verdict: v && v.old_state === oldState && v.new_state === newState ? v.verdict : null,
      note: v?.note ?? null,
    };
  });

  const derivedFacts = deriveSearchFacts(live);
  const currentFacts = search?.facts ?? [];
  const facets = FACETS.map(f => ({
    facet: f, label: FACET_LABEL[f],
    current: currentFacts.filter(x => x.facet === f && x.subject === "organization"),
    derived: derivedFacts.filter(x => x.facet === f),
  }));

  return {
    analysed: docs.length,
    orgType,
    readiness: {
      rows,
      currentPct: readinessScore(items, current),
      derivedPct: readinessScore(items, derivedState),
      currentComputedAt: coverage.computedAt,
      gate: comparisonGate(rows),
      unlock: { current: essentialsAtLeastThin(orgType, current), derived: essentialsAtLeastThin(orgType, derivedState) },
    },
    eligibility,
    search: { currentAt: search?.generatedAt ?? null, facets },
  };
}
