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
 * Three jobs. Drop near-duplicates, since the same sentence about what an
 * organization does turns up in the website capture, the strategic plan and the
 * board deck. Cap each facet, because thirty ways of saying "job training"
 * makes a worse query than three, and the query builders take the first few
 * anyway. And take from every layer, which is the part this used to get wrong.
 *
 * WHAT WENT WRONG, because the reasoning still holds and the implementation did
 * not. Layer II and III outrank Layer I within a facet: internal strategy and
 * the client's own voice say what the organization actually needs, where the
 * public story says what it wants the world to think, and for finding money the
 * first is worth more. That is an argument about ORDER. It was implemented as a
 * hard sort followed by "keep the first six", which is a different thing
 * entirely: every Layer II fact was considered before any Layer III fact, so a
 * client with enough Layer II documents filled every facet from Layer II alone
 * and nothing else could ever enter.
 *
 * On RE-Assist that was not a lean, it was a wipe. 445 facts were extracted and
 * 48 were kept, all of them Layer II. All 192 facts from three call transcripts
 * were discarded, including every one of the 99 from the Howie intro call, and
 * so were all 82 from the public story. The `distinctive` facet, which is meant
 * to hold what a programme officer would remember, was drawn entirely from
 * signed proposals, which is the one source least likely to contain it.
 *
 * So slots are allocated round-robin across layers in rank order rather than
 * filled by precedence. Layer II still goes first and still takes the largest
 * share of a partly-filled facet; it can no longer take all of one. Layers with
 * nothing to offer for a facet cost nothing: their turns fall through and the
 * remaining slots go to whoever has candidates left, still in rank order.
 */
export const MAX_PER_FACET = 8;
/** Turn order within a facet, and the tie-break when slots are left over. */
const LAYER_ORDER = ["II", "III", "I"] as const;
const LAYER_RANK: Record<string, number> = { II: 0, III: 1, I: 2 };

export function mergeFacts(all: ProfileFact[], maxPerFacet = MAX_PER_FACET): ProfileFact[] {
  const seen = new Set<string>();
  const byFacet = new Map<Facet, ProfileFact[]>();

  // Deduplicate first, in rank order, so the surviving copy of a fact stated in
  // both a proposal and a transcript is credited to the stronger layer.
  const ranked = [...all].sort((a, b) =>
    (LAYER_RANK[a.layer ?? "I"] ?? 3) - (LAYER_RANK[b.layer ?? "I"] ?? 3));

  const pool = new Map<Facet, Map<string, ProfileFact[]>>();
  for (const f of ranked) {
    const key = `${f.facet}|${f.text.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const layer = LAYER_ORDER.includes((f.layer ?? "I") as typeof LAYER_ORDER[number])
      ? (f.layer as string) : "I";
    const perFacet = pool.get(f.facet) ?? new Map<string, ProfileFact[]>();
    const perLayer = perFacet.get(layer) ?? [];
    perLayer.push(f);
    perFacet.set(layer, perLayer);
    pool.set(f.facet, perFacet);
  }

  for (const [facet, perFacet] of pool) {
    const taken: ProfileFact[] = [];
    const at = new Map<string, number>(LAYER_ORDER.map(l => [l, 0]));
    // Round-robin until the facet is full or every layer is exhausted. An empty
    // layer simply does not take its turn, so a client with no transcripts is
    // not punished with a shorter profile.
    let served = true;
    while (taken.length < maxPerFacet && served) {
      served = false;
      for (const layer of LAYER_ORDER) {
        if (taken.length >= maxPerFacet) break;
        const list = perFacet.get(layer) ?? [];
        const i = at.get(layer) ?? 0;
        if (i >= list.length) continue;
        taken.push(list[i]);
        at.set(layer, i + 1);
        served = true;
      }
    }
    byFacet.set(facet, taken);
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

/**
 * What the profile is, in one paragraph, at the top of every build.
 *
 * Written to be read by whoever is watching rather than stored per run: a
 * constant, not an event row. It is the only place the product explains why it
 * is about to spend three minutes reading.
 */
export const PROFILE_INTRO =
  "A Funder Matching Profile is the short, evidenced description of this client that For Granted "
  + "searches on. It is built by reading their Inven(s)tory one document at a time and keeping only "
  + "facts backed by a direct quote, tagged by whether they describe the client, a competitor or a "
  + "partner. Competitor and partner lines are kept and deliberately never searched on.";
