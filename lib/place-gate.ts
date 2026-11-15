// The international screen (patch 47, 15 Nov 2026): what an opportunity's own
// wording says about WHERE an applicant must be, read against a client whose
// country is known.
//
// Same principle as the hardened screen (patch 44): exclude only on
// unambiguous wording; everything else is a named reason that caps at "check".
// One addition: when the country is known, the location is known. A client
// registered in Kenya is not "location not on file" for an Ohio-only grant.
//
// Pure and free of `server-only`; tested in tests/funding/international-screen.test.ts.
import { COUNTRIES, COUNTRY_ALIASES, REGIONS, REGION_ALIASES } from "@/lib/countries";
import { STATE_NAME_TO_CODE } from "@/lib/us-states";
import { isUsBased, type EligibilityProfile } from "@/lib/eligibility-fields";

// ---- Where the client stands with the United States ----

const hasUsStates = (p: EligibilityProfile) => !!p.state_code || (p.service_area ?? []).length > 0;

/** Registered abroad. The United States is the default when no country is set. */
export const isAbroad = (p: EligibilityProfile) => !isUsBased(p);

/**
 * A US entity of its own: registered in the US, a 501(c)(3) by tax status (a
 * "Friends of" entity counts), or working in US states or naming the US among
 * its countries. US-restricted money is open to it on the usual terms.
 */
export function hasUsEntity(p: EligibilityProfile): boolean {
  return isUsBased(p) || p.tax_status === "501c3" || hasUsStates(p) || (p.countries_served ?? []).includes("US");
}

/** No US entity, but a fiscal sponsor on file: US-restricted money is possible only through it. */
export function hasUsSponsor(p: EligibilityProfile): boolean {
  return !hasUsEntity(p) && (!!(p.fiscal_sponsor ?? "").trim() || p.org_type === "fiscally_sponsored");
}

// ---- US-only wording ----

/** Phrases that close a call to anyone outside the United States. */
export const US_ONLY = new RegExp([
  String.raw`\bU\.?S\.?-based\b`,
  String.raw`\b(?:based|located|headquartered|incorporated|registered|domiciled|established) in the (?:United States|U\.S\.A?\.?|USA)(?! or\b)(?! and\b)`,
  String.raw`\b(?:United States|U\.S\.|USA) only\b`,
  String.raw`\bonly (?:to|for) (?:U\.S\.|US|United States|American) (?:organi[sz]ations|nonprofits|applicants|entities|companies|institutions)\b`,
  String.raw`\b(?:U\.S\.|US|United States|American) (?:organi[sz]ations|nonprofits|applicants|entities|companies|institutions|citizens) only\b`,
  String.raw`\bmust be (?:a |an )?(?:U\.S\.|US|United States|American) (?:organi[sz]ation|entity|company|nonprofit|institution|citizen)`,
  String.raw`\bdomestic (?:organi[sz]ations|applicants|nonprofits|entities|institutions|public (?:or|and) private)\b`,
].join("|"), "i");

/** Words that say a US-database record also funds outside the United States. */
export const BEYOND_US = /\b(international(?:ly)?|global(?:ly)?|worldwide|any country|all countries|outside (?:of )?the (?:United States|U\.S\.|US)|non-U\.?S\.?|foreign (?:organi[sz]ations|entities|applicants|nonprofits)|developing countr(?:y|ies)|low[- ]and[- ]middle[- ]income|LMICs?|global south|overseas|abroad)\b/i;

// ---- Places a clause can name ----

// Names left out because they read as something else too often to exclude on.
const AMBIGUOUS = new Set(["GE", "JE", "GG", "IM", "AQ", "BV", "HM", "GS", "IO", "UM"]);

interface PlaceTerm { name: string; codes: readonly string[] }

const PLACE_TERMS: PlaceTerm[] = (() => {
  const out: PlaceTerm[] = [];
  for (const [code, name] of COUNTRIES) {
    if (AMBIGUOUS.has(code)) continue;
    for (const n of [name, ...(COUNTRY_ALIASES[code] ?? [])]) out.push({ name: n.toLowerCase(), codes: [code] });
  }
  out.push({ name: "united states", codes: ["US"] });
  // Regions by label, and each wider alias as the union of every region that carries it
  // ("africa" is all five African regions; "sub-saharan africa" is four).
  const byAlias = new Map<string, Set<string>>();
  for (const r of REGIONS) {
    if (r.key === "global" || !r.members.length) continue;
    out.push({ name: r.label.toLowerCase(), codes: r.members });
    for (const a of REGION_ALIASES[r.key] ?? []) {
      const set = byAlias.get(a.toLowerCase()) ?? new Set<string>();
      r.members.forEach(m => set.add(m));
      byAlias.set(a.toLowerCase(), set);
    }
  }
  for (const [a, set] of byAlias) out.push({ name: a, codes: [...set] });
  return out.sort((a, b) => b.name.length - a.name.length);
})();

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_CODES = new Map(PLACE_TERMS.map(t => [t.name, t.codes] as const));
// No lookbehind on purpose: this module is shared with the browser, and the
// leading group does the same job everywhere.
const PLACE_RE = new RegExp(`(^|[^a-z])(${[...new Set(PLACE_TERMS.map(t => esc(t.name)))].join("|")})(?![a-z])`, "gi");
const STATE_RE = new RegExp(`\\b(${Object.keys(STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length).map(esc).join("|")})\\b`, "i");

// Words that may sit between the restriction phrase and the first place.
const LEAD_IN = /^(?:(?:the|a|an|any|one|of|in|following|eligible|target|focus|participating|selected|partner|member|countr(?:y|ies)|regions?|states?|republic|kingdom|federal|rural|urban|at|least)\b[\s:,]*)*/i;
// A list that is not closed: more places are allowed than the ones named.
const OPEN_LIST = /\b(worldwide|globally|global|any country|all countries|international(?:ly)?|including|such as|e\.g\.|for example|among others|and other|and beyond|or elsewhere|not limited to|other countries|other regions)\b/i;

type Kind = "registered" | "anywhere";
const PHRASES: { kind: Kind; re: RegExp }[] = [
  // Where the organization is legally: only its country of registration answers this.
  { kind: "registered", re: /\b(?:registered|incorporated|headquartered|domiciled|legally established|legally registered)(?:\s+(?:as\s+)?[a-z-]+){0,3}?\s+in\s+([^.;:()]{2,220})/gi },
  { kind: "registered", re: /\b(?:nationals|citizens)\s+of\s+([^.;:()]{2,220})/gi },
  // Where it is or works: its country of registration or anywhere it works answers this.
  { kind: "anywhere", re: /\b(?:based|located|established|residents?)\s+(?:in|of)\s+([^.;:()]{2,220})/gi },
  { kind: "anywhere", re: /\b(?:working|operating|operate|work|active|implemented|implementing|serving (?:communities|people|populations))\s+(?:primarily\s+|exclusively\s+|only\s+)?in\s+([^.;:()]{2,220})/gi },
  { kind: "anywhere", re: /\b(?:organi[sz]ations?|applicants?|companies|start-?ups?|businesses|enterprises|entities|nonprofits?|NGOs?|charities|institutions|entrepreneurs|innovators|founders|projects|activities)\s+(?:from|in|within|across)\s+([^.;:()]{2,220})/gi },
];

export interface PlaceRestriction {
  /** How the wording restricts: by registration, or by presence or work. */
  kind: Kind;
  /** Every country the clause allows (regions expanded to their members). */
  allowed: Set<string>;
  /** The places as written, for the reason shown to a person. */
  label: string;
}

/**
 * The closed lists of places an eligibility text restricts applicants to.
 * A clause counts only when a place follows the restriction phrase directly
 * ("registered in Ghana, Kenya or Rwanda"), names no US state (the state rule
 * owns those), and is not an open list ("including", "worldwide").
 */
export function placeRestrictions(elig: string): PlaceRestriction[] {
  const out: PlaceRestriction[] = [];
  for (const { kind, re } of PHRASES) {
    for (const m of elig.matchAll(re)) {
      const clause = m[1];
      if (STATE_RE.test(clause) || OPEN_LIST.test(clause)) continue;
      const body = clause.replace(LEAD_IN, "");
      const hits = [...body.matchAll(PLACE_RE)];
      if (!hits.length || (hits[0].index ?? 99) + hits[0][1].length > 2) continue;
      const allowed = new Set<string>();
      const names: string[] = [];
      for (const h of hits) {
        const key = h[2].toLowerCase();
        (TERM_CODES.get(key) ?? []).forEach(c => allowed.add(c));
        if (!names.includes(h[2])) names.push(h[2]);
      }
      if (allowed.size) out.push({ kind, allowed, label: names.slice(0, 6).join(", ") });
    }
  }
  return out;
}

/** The countries that answer each kind of restriction for this client. */
export function clientPlaces(p: EligibilityProfile): { registered: Set<string>; anywhere: Set<string> } {
  const home = p.country_code ?? "US";
  const registered = new Set<string>([home]);
  if (hasUsEntity(p)) registered.add("US");
  const anywhere = new Set<string>([...registered, ...(p.countries_served ?? [])]);
  for (const r of p.regions_served ?? []) REGIONS.find(x => x.key === r)?.members.forEach(c => anywhere.add(c));
  return { registered, anywhere };
}

/** The first restriction this client falls outside, or null when none shuts it out. */
export function outsideRestriction(elig: string, p: EligibilityProfile): PlaceRestriction | null {
  const mine = clientPlaces(p);
  for (const r of placeRestrictions(elig)) {
    const set = r.kind === "registered" ? mine.registered : mine.anywhere;
    if (![...set].some(c => r.allowed.has(c))) return r;
  }
  return null;
}
