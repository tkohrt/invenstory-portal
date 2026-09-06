// The Search Profile: what we say about a client when we go looking for money.
//
// Until now the query sent to the Ledger was built from a dozen eligibility
// fields. The client's Inven(s)tory, which is the whole point of this product,
// was used only to explain matches after the fact. This is the structure that
// changes that.
//
// THE LESSON THIS IS BUILT AROUND. A run for a healthtech company came back
// with patient-assistance funds and scholarships: money for the people the
// client serves, not for the client. The search did exactly what it was asked,
// because the query described who they serve. Layer I documents are full of
// text about beneficiaries, partners and the competitive landscape, so feeding
// the whole Inven(s)tory in naively makes that failure worse, not better.
//
// The readiness engine already solved this. It began as retrieval routing,
// failed twice on real data, and landed on document-level extraction with
// verbatim quotes plus subject quarantine, where every finding is tagged
// organization, competitor or third_party and the code (not the prompt)
// enforces what each may be used for. This inherits that discipline exactly.
//
// Pure and free of `server-only` so the query rules are unit testable without
// a database or a model.

import type { EligibilityProfile } from "@/lib/eligibility-fields";
import { ORG_TYPES } from "@/lib/eligibility-fields";

/** Who a quoted line is actually about. Same vocabulary as doc-extract. */
export type Subject = "organization" | "competitor" | "third_party";

/**
 * The facets of a fundable story.
 *
 * These are not a general summary of an organization. Each one exists because
 * it answers a question a funder search needs answered, and each becomes its
 * own query angle once multi-query lands.
 */
export const FACETS = [
  "identity",       // what kind of organization this is, in a funder's terms
  "work",           // what they actually do: programmes, products, services
  "need",           // what they want funded. The crux, and the most often absent
  "evidence",       // what they can prove: outcomes, traction, real numbers
  "geography",      // where they work, at the granularity funders care about
  "distinctive",    // what a programme officer would remember about them
  // Extracted and shown, never searched on. Eligibility is a screen, not a
  // description: a semantic index does nothing useful with "not registered in
  // SAM.gov", while the screener does. Its job here is to catch a document
  // saying something the eligibility form does not.
  "constraints",
  "beneficiaries",  // who they serve. Captured, quarantined. See below
] as const;
export type Facet = (typeof FACETS)[number];

export const FACET_LABEL: Record<Facet, string> = {
  identity: "What kind of organization",
  work: "What they do",
  need: "What they want funded",
  evidence: "What they can prove",
  geography: "Where they work",
  distinctive: "What makes them memorable",
  constraints: "What limits eligibility",
  beneficiaries: "Who they serve",
};

/**
 * Which facets may describe the applicant when searching for GRANTS.
 *
 * `beneficiaries` is deliberately absent, and that absence is the single most
 * important line in this file. A grant search describes the ORGANISATION and
 * the funding it can use. Describing who it serves is how a healthtech company
 * was offered scholarships and patient-assistance funds.
 */
export const GRANT_FACETS: readonly Facet[] =
  ["identity", "work", "need", "evidence", "distinctive"];

/**
 * Which facets may describe the applicant when searching for FUNDERS.
 *
 * Here `beneficiaries` belongs: who a funder backs genuinely does depend on the
 * population and the cause. This asymmetry between the two searches is the
 * point, not an inconsistency.
 */
export const FUNDER_FACETS: readonly Facet[] =
  ["identity", "work", "beneficiaries", "geography", "distinctive"];

/** One line of the profile, and where it came from. */
export interface ProfileFact {
  facet: Facet;
  /** A short clause in the organization's own terms, usable in a query. */
  text: string;
  /** Verbatim from the document. A fact with no quote is not a fact. */
  quote: string;
  documentId: string;
  documentTitle: string;
  /** I public story, II internal strategy, III living voice. Null if unknown. */
  layer: "I" | "II" | "III" | null;
  /**
   * Who the quote is about. Only `organization` may describe the applicant.
   * Competitor and third-party lines are kept, because knowing a client's
   * partners and rivals is useful elsewhere, and quarantined here.
   */
  subject: Subject;
}

export interface SearchProfile {
  facts: ProfileFact[];
  generatedAt: string;
  /** How many ready documents were read to build this. */
  documentCount: number;
  /** Which layers contributed, so thinness is visible rather than implied. */
  layers: ("I" | "II" | "III")[];
}

/**
 * Facts that may describe the applicant, for a given search.
 *
 * Two filters, both enforced here rather than in a prompt: the subject must be
 * the organization itself, and the facet must be allowed for this search.
 */
export function usableFacts(p: SearchProfile, allowed: readonly Facet[]): ProfileFact[] {
  return p.facts.filter(f => f.subject === "organization" && allowed.includes(f.facet));
}

function joinFacet(facts: ProfileFact[], facet: Facet, max = 3): string {
  return facts.filter(f => f.facet === facet).slice(0, max).map(f => f.text.trim()).filter(Boolean).join("; ");
}

/**
 * Query text for the GRANTS index.
 *
 * Leads with what the organization is and what it wants funded, because that is
 * what a solicitation is matched against. Returns several angles rather than
 * one blended paragraph: a single long query averages out into mush, where
 * three sharper ones each retrieve a different neighbourhood.
 */
export function grantQueries(
  p: SearchProfile, e: EligibilityProfile, orgName: string,
): string[] {
  const f = usableFacts(p, GRANT_FACETS);
  const kind = ORG_TYPES.find(t => t.v === e.org_type)?.l ?? "organization";
  const geo = e.state_code ? ` based in ${e.state_code}` : "";

  const identity = joinFacet(f, "identity") || `${kind.toLowerCase()}${geo}`;
  const work = joinFacet(f, "work");
  const need = joinFacet(f, "need");
  const evidence = joinFacet(f, "evidence", 2);
  const distinctive = joinFacet(f, "distinctive", 2);
  // Note what is NOT here: constraints. See GRANT_FACETS.

  const out = [
    // 1. The organization and the money it can use. The workhorse.
    [orgName, identity, work, need ? `seeking funding for ${need}` : null]
      .filter(Boolean).join(", "),
    // 2. The need on its own, phrased as a funding request rather than a
    //    description, which is closer to how solicitations are written.
    need ? `funding for ${need}${geo}, ${identity}` : null,
    // 3. What they can prove. Finds programmes that ask for a track record.
    evidence ? `${identity} with ${evidence}${distinctive ? `, ${distinctive}` : ""}` : null,
  ].filter(Boolean) as string[];

  return dedupeQueries(out);
}

/**
 * Query text for the FUNDER index.
 *
 * Different question, so different text. A funder is matched on mission
 * alignment and who they back, which is why beneficiaries belong here and not
 * in the grant queries.
 */
export function funderQueries(
  p: SearchProfile, e: EligibilityProfile, orgName: string,
): string[] {
  const f = usableFacts(p, FUNDER_FACETS);
  const kind = ORG_TYPES.find(t => t.v === e.org_type)?.l ?? "organization";
  const geo = joinFacet(f, "geography") || e.state_code || "";

  const identity = joinFacet(f, "identity") || kind.toLowerCase();
  const work = joinFacet(f, "work");
  const served = joinFacet(f, "beneficiaries");
  const distinctive = joinFacet(f, "distinctive", 2);

  const out = [
    [orgName, identity, work, geo ? `working in ${geo}` : null].filter(Boolean).join(", "),
    served ? `${identity} serving ${served}${geo ? ` in ${geo}` : ""}` : null,
    distinctive ? `${identity}, ${distinctive}` : null,
  ].filter(Boolean) as string[];

  return dedupeQueries(out);
}

/**
 * Constraints stated in the documents, for the admin panel and for catching a
 * mismatch with the eligibility form.
 *
 * Never query text. If a strategic plan says "fiscally sponsored" and the form
 * says 501(c)(3), one of them is wrong and somebody should know before a client
 * spends a week on an application.
 */
export function constraintFacts(p: SearchProfile): ProfileFact[] {
  return p.facts.filter(f => f.subject === "organization" && f.facet === "constraints");
}

/** Drop near-identical angles; three copies of one query is one query. */
export function dedupeQueries(qs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of qs) {
    const t = q.trim().replace(/\s+/g, " ");
    if (t.length < 12) continue;
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export interface ProfileHealth {
  /** Enough to search on. False means say so rather than searching on nothing. */
  usable: boolean;
  missing: Facet[];
  /** Plain sentence for the admin running the match. */
  note: string;
}

/**
 * Is this profile worth searching on?
 *
 * A thin Inven(s)tory produces a thin profile, and a thin profile produces
 * results that look like the tool is bad when the input was. Saying so up front
 * is cheaper than explaining it afterwards.
 */
export function assessProfile(p: SearchProfile): ProfileHealth {
  const present = new Set(usableFacts(p, FACETS).map(f => f.facet));
  // These three carry the search. Geography and constraints refine it; the rest
  // is colour.
  const core: Facet[] = ["identity", "work", "need"];
  const missing = core.filter(c => !present.has(c));

  if (!p.documentCount) {
    return { usable: false, missing: core, note: "No documents in the Inven(s)tory yet, so there is nothing to search on beyond the eligibility profile." };
  }
  if (missing.length === core.length) {
    return { usable: false, missing, note: `Read ${p.documentCount} document(s) and found nothing that describes the organization itself. Matching will fall back to the eligibility profile.` };
  }
  if (missing.includes("need")) {
    return {
      usable: true, missing,
      note: `Built from ${p.documentCount} document(s), but nothing states what they want funded. Results will lean on what they do rather than what they need, which is usually the weaker signal.`,
    };
  }
  if (missing.length) {
    return { usable: true, missing, note: `Built from ${p.documentCount} document(s). Missing: ${missing.map(m => FACET_LABEL[m].toLowerCase()).join(", ")}.` };
  }
  const layers = p.layers.length ? p.layers.join(", ") : "none recorded";
  return { usable: true, missing: [], note: `Built from ${p.documentCount} document(s) across layer ${layers}.` };
}

// ---------------------------------------------------------------------------
// Turning a model's answer into facts. Pure, so the parsing and the guards can
// be tested without a model or a database.
// ---------------------------------------------------------------------------

const FACET_SET = new Set<string>(FACETS);
const SUBJECTS = new Set<string>(["organization", "competitor", "third_party"]);

/** Where a fact came from, supplied by the caller rather than the model. */
export interface FactSource {
  documentId: string;
  documentTitle: string;
  layer: "I" | "II" | "III" | null;
}

/**
 * Parse one document's worth of model output.
 *
 * Deliberately strict about structure and unforgiving about missing quotes. A
 * fact with no verbatim support is exactly the failure the readiness engine
 * spent two iterations eliminating: a plausible sentence, sourced to nothing,
 * that reads as evidence. Here it would silently become search text.
 *
 * The subject defaults to `organization` ONLY when the model omitted it, which
 * matches doc-extract. That is the permissive direction, so the facet rules in
 * GRANT_FACETS and FUNDER_FACETS remain the real guard.
 */
export function parseFacts(raw: string, src: FactSource): ProfileFact[] {
  const out: ProfileFact[] = [];
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return out;

  let arr: unknown;
  try { arr = JSON.parse(m[0]); } catch { return out; }
  if (!Array.isArray(arr)) return out;

  for (const o of arr) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const facet = typeof r.facet === "string" ? r.facet : "";
    const text = typeof r.text === "string" ? r.text.trim() : "";
    const quote = typeof r.quote === "string" ? r.quote.trim() : "";
    if (!FACET_SET.has(facet)) continue;
    // No quote, no fact. This is the line that keeps a query traceable.
    if (!text || !quote) continue;
    const subject = typeof r.subject === "string" && SUBJECTS.has(r.subject)
      ? (r.subject as Subject) : "organization";
    out.push({
      facet: facet as Facet,
      text: text.slice(0, 300),
      quote: quote.slice(0, 600),
      documentId: src.documentId,
      documentTitle: src.documentTitle,
      layer: src.layer,
      subject,
    });
  }
  return out;
}

/**
 * Combine facts from every document into one profile.
 *
 * Two jobs. Drop near-duplicates, since the same sentence about what an
 * organization does turns up in the website capture, the strategic plan and the
 * board deck. And cap each facet, because thirty ways of saying "job training"
 * makes a worse query than three, and the query builders take the first few
 * anyway.
 *
 * Ordering is deliberate: a fact from Layer II or III outranks one from Layer I
 * within a facet. Internal strategy and the client's own voice say what the
 * organization actually needs; the public story says what it wants the world to
 * think. For finding money, the first is worth more.
 */
export const MAX_PER_FACET = 6;
const LAYER_RANK: Record<string, number> = { II: 0, III: 1, I: 2 };

export function mergeFacts(all: ProfileFact[], maxPerFacet = MAX_PER_FACET): ProfileFact[] {
  const seen = new Set<string>();
  const byFacet = new Map<Facet, ProfileFact[]>();

  const ranked = [...all].sort((a, b) =>
    (LAYER_RANK[a.layer ?? "I"] ?? 3) - (LAYER_RANK[b.layer ?? "I"] ?? 3));

  for (const f of ranked) {
    const key = `${f.facet}|${f.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byFacet.get(f.facet) ?? [];
    if (list.length >= maxPerFacet) continue;
    list.push(f);
    byFacet.set(f.facet, list);
  }

  // Emit in facet order so the stored profile reads the way the panel shows it.
  return FACETS.flatMap(f => byFacet.get(f) ?? []);
}

/** A stable id for the current document set, so staleness is noticed. */
export function documentFingerprint(docs: { id: string }[]): string {
  const ids = docs.map(d => d.id).sort().join(",");
  let h = 0;
  for (let i = 0; i < ids.length; i++) { h = (h * 31 + ids.charCodeAt(i)) | 0; }
  return `${docs.length}:${(h >>> 0).toString(36)}`;
}

/**
 * The text of a document, from its chunks.
 *
 * ONE function, because the length of what this returns is compared against a
 * length recorded on a previous run to decide whether a document needs
 * re-reading. Two places computing it two ways is exactly the bug this replaces:
 * the reader joined chunks with newlines and stored 3146, the staleness
 * pre-filter summed the chunks alone and got 3143, they never matched, and every
 * document looked changed on every pass. The chain re-read the same five
 * documents forever and could not advance.
 *
 * Ordered by chunk_index, so the text and its hash are stable run to run.
 * Postgres makes no promise about the order of an unordered select.
 */
export function chunkText(rows: { text: string | null }[]): string {
  return rows.map(c => c.text ?? "").join("\n");
}
