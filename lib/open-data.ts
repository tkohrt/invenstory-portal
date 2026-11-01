// Public international funding data (patch 4 of the 1 November 2026 build).
//
// Ground Truth's base is a snapshot of US funders and grants, so a client
// working in Kenya was matched only against money it mostly cannot use. These
// are public, free, machine-readable sources that cover the rest of the world,
// searched live in the same run as Ground Truth, and only for a client whose
// profile looks abroad (wantsInternational) and wants what the source holds:
//
//   World Bank procurement notices   search.worldbank.org/api/v2/procnotices
//     Open tenders, requests for expressions of interest and invitations for
//     bids on World Bank financed projects in 100+ countries. Consulting and
//     technical-assistance work, so it answers "contracts". No key. CC-BY 4.0.
//   EU Funding & Tenders Portal       api.tech.ec.europa.eu/search-api (SEDIA)
//     EU grant topics, EuropeAid (international partnerships) calls, cascade
//     funding from EU projects, and EU calls for tenders. No key.
//   IATI Datastore                    api.iatistandard.org/datastore
//     Who funds aid and development activities in which country. Funders, not
//     opportunities, so it adds to "funders worth approaching". Needs a free
//     key (IATI_API_KEY); without one it is skipped and says so.
//
// Decoders were written against real responses captured on 1 November 2026
// (tests/fixtures/open-data), because the ledger taught that documentation and
// reality differ: World Bank country filtering only works on project_ctry_name,
// several words in qterm are ANDed (quoted phrases with OR are not), and the
// EU index still marks long-closed calls "open", so deadlines are checked here.
// The IATI decoder follows the published field list and has NOT been run
// against a live response yet: it reads defensively and drops what it cannot.
//
// Pure and free of `server-only`; the fetching is lib/server/open-data.ts.
import { kindsSought, wantsInternational, profileCountries, type EligibilityProfile, type FundingKind } from "@/lib/eligibility-fields";
import { COUNTRY_NAME, REGIONS } from "@/lib/countries";
import type { GrantCard } from "@/lib/ledger-types";
import { placeNamed } from "@/lib/grant-screen";
import type { FunderRow } from "@/lib/funder-rows";

export type OpenSource = "worldbank" | "eu_ft" | "iati";

/** Where a row came from, in words a client can read. */
export const SOURCE_LABEL: Record<string, string> = {
  ledger: "Ground Truth",
  worldbank: "World Bank procurement notices",
  eu_ft: "EU Funding & Tenders Portal",
  iati: "International aid data (IATI)",
  threesixty: "UK grants data (360Giving)",
  web: "the web search",
};

/** Short form for a table cell. */
export const SOURCE_SHORT: Record<string, string> = {
  ledger: "Ground Truth", worldbank: "World Bank", eu_ft: "EU portal", iati: "IATI", web: "Web",
  threesixty: "360Giving",
};

export interface OpenOpportunity {
  /** Namespaced so it can never equal a Ground Truth id: "wb:OP00478446", "eu:...". */
  id: string;
  source: Exclude<OpenSource, "iati">;
  title: string;
  /** Who is buying or distributing the money, as the record states it. */
  funder: string | null;
  url: string;
  close_date: string | null;
  award: number | null;
  currency: string | null;
  /** Plain text the screen reads: notice body, country, programme, eligibility. */
  text: string;
  countries: string[];
  money_kind: FundingKind;
}

// ---------------------------------------------------------------------------
// What to search, for whom
// ---------------------------------------------------------------------------

export interface OpenPlan {
  /** One query per country (at most MAX_WB_COUNTRIES), or one global query when none. */
  worldbank: { countries: string[] } | null;
  /** SEDIA type codes: 0 tender, 1 grant topic, 2 EuropeAid call, 8 cascade funding. */
  eu: { types: string[] } | null;
  iati: { countries: string[] } | null;
}

export const MAX_WB_COUNTRIES = 4;
export const MAX_IATI_COUNTRIES = 8;

/** Countries to search: everything named in the profile outside the US, then region members. */
export function searchCountries(p: EligibilityProfile, max: number): string[] {
  const named = profileCountries(p).filter(c => c !== "US");
  if (named.length) return named.slice(0, max);
  // Only a region was given: its members, in list order, up to the cap.
  const fromRegions: string[] = [];
  for (const r of p.regions_served ?? []) {
    const reg = REGIONS.find(x => x.key === r);
    if (!reg || r === "north_america") continue;
    for (const m of reg.members) if (!fromRegions.includes(m)) fromRegions.push(m);
  }
  return fromRegions.slice(0, max);
}

/**
 * Which public sources this client's search should use. A US-only profile gets
 * none of them, so nothing changes for it. Pure, so the rules are tested.
 */
export function planOpenSources(p: EligibilityProfile): OpenPlan {
  if (!wantsInternational(p)) return { worldbank: null, eu: null, iati: null };
  const kinds = kindsSought(p);
  const types = new Set<string>();
  if (kinds.includes("grants")) { types.add("1"); types.add("2"); types.add("8"); }
  if (kinds.includes("programs")) types.add("8");
  if (kinds.includes("contracts")) types.add("0");
  const wants = (k: FundingKind) => kinds.includes(k);
  return {
    worldbank: wants("contracts") ? { countries: searchCountries(p, MAX_WB_COUNTRIES) } : null,
    eu: types.size ? { types: [...types].sort() } : null,
    iati: (wants("grants") || wants("programs")) && searchCountries(p, MAX_IATI_COUNTRIES).length
      ? { countries: searchCountries(p, MAX_IATI_COUNTRIES) } : null,
  };
}

/**
 * Short phrases to search on. These sources are keyword indexes, not semantic
 * ones, so a paragraph finds nothing (several words are ANDed). The cause areas
 * are the client's own words for their work; a couple of the search profile's
 * facts can be added by the caller.
 */
export function searchPhrases(p: EligibilityProfile, extra: string[] = [], max = 4): string[] {
  const out: string[] = [];
  for (const raw of [...p.cause_areas, ...extra]) {
    const t = raw.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length < 3 || t.split(" ").length > 4) continue;
    if (!out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** World Bank qterm: quoted phrases joined with OR (plain words would be ANDed). */
export function worldBankTerm(phrases: string[]): string {
  return phrases.map(ph => `"${ph}"`).join(" OR ");
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-" };

/** Notice bodies arrive as HTML. Tags out, common entities decoded, spaces collapsed. */
export function plainText(html: unknown, max = 2000): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 31 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ").trim().slice(0, max);
}

const str = (v: unknown): string | null => {
  if (Array.isArray(v)) v = v[0];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** "2026-12-02T00:00:00Z" or "2026-12-02T17:00:00.000+0000" -> "2026-12-02". */
export function isoDay(v: unknown): string | null {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.slice(0, 10));
  return isNaN(d.getTime()) ? null : s.slice(0, 10);
}

function countryCodeFor(name: string | null): string[] {
  if (!name) return [];
  const t = name.toLowerCase();
  const hit = Object.entries(COUNTRY_NAME).find(([, n]) => n.toLowerCase() === t);
  return hit ? [hit[0]] : [];
}

/**
 * World Bank procurement notices.
 *
 * Kept: notices still open (a submission deadline today or later). Dropped:
 * contract awards (the work is already given), and notices with no deadline
 * older than 60 days, which in practice are closed.
 */
export function decodeWorldBank(json: unknown, today = new Date()): OpenOpportunity[] {
  const list = (json as { procnotices?: unknown })?.procnotices;
  if (!Array.isArray(list)) return [];
  const todayDay = today.toISOString().slice(0, 10);
  const out: OpenOpportunity[] = [];
  for (const raw of list) {
    const n = raw as Record<string, unknown>;
    const id = str(n.id);
    if (!id) continue;
    const type = str(n.notice_type) ?? "";
    if (/award/i.test(type)) continue;
    const deadline = isoDay(n.submission_deadline_date);
    if (deadline && deadline < todayDay) continue;
    if (!deadline) {
      const posted = isoDay(n.submission_date);
      if (!posted || (today.getTime() - new Date(posted).getTime()) > 60 * 86_400_000) continue;
    }
    const country = str(n.project_ctry_name);
    const title = str(n.bid_description) ?? str(n.project_name) ?? "World Bank procurement notice";
    const buyer = str(n.contact_organization);
    out.push({
      id: `wb:${id}`,
      source: "worldbank",
      title: title.slice(0, 400),
      funder: buyer ? `${buyer} (World Bank financed)` : "World Bank financed project",
      url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${encodeURIComponent(id)}`,
      close_date: deadline,
      award: null,
      currency: null,
      text: [type, country ? `Country: ${country}` : null, str(n.project_name), str(n.procurement_method_name),
        plainText(n.notice_text, 1500)].filter(Boolean).join(". "),
      countries: countryCodeFor(country),
      money_kind: "contracts",
    });
  }
  return out;
}

const EU_PORTAL = "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities";

/** A grant topic's search URL is its JSON data file; the person wants the page. */
function euPageUrl(type: string, url: string | null, identifier: string | null): string | null {
  if (type === "1" && identifier) return `${EU_PORTAL}/topic-details/${encodeURIComponent(identifier)}`;
  return url;
}

/**
 * EU Funding & Tenders Portal search results.
 *
 * Kept only with a deadline today or later: the index labels calls from 2023
 * "open", so its status field cannot be trusted. A call without any deadline
 * is dropped too, since the index cannot say it is still running.
 */
export function decodeSedia(json: unknown, today = new Date()): OpenOpportunity[] {
  const list = (json as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  const todayDay = today.toISOString().slice(0, 10);
  const out: OpenOpportunity[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const r = raw as { url?: string; summary?: string; metadata?: Record<string, unknown> };
    const m = r.metadata ?? {};
    const type = str(m.type) ?? "";
    if (!["0", "1", "2", "8"].includes(type)) continue;
    const deadline = isoDay(m.deadlineDate);
    if (!deadline || deadline < todayDay) continue;
    const identifier = str(m.identifier) ?? str(m.callIdentifier);
    const url = euPageUrl(type, str(m.url) ?? r.url ?? null, identifier);
    if (!url || !/^https:\/\//.test(url)) continue;
    const key = identifier ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = str(m.title) ?? str(r.summary) ?? "EU call";
    const budget = Number(str(m.budget));
    const zones = Array.isArray(m.geographicalZones) ? (m.geographicalZones as unknown[]).filter(z => typeof z === "string") as string[] : [];
    const funder =
      type === "8" ? `${str(m.projectAcronym) ?? "An EU-funded project"} (EU cascade funding)`
      : type === "2" ? "European Commission (International Partnerships)"
      : type === "0" ? `European Commission${str(m.caName) && str(m.caName) !== "true" ? ` (${str(m.caName)})` : ""}`
      : "European Commission";
    out.push({
      id: `eu:${type}:${key}`.slice(0, 400),
      source: "eu_ft",
      title: title.slice(0, 400),
      funder,
      url,
      close_date: deadline,
      award: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : null,
      currency: Number.isFinite(budget) && budget > 0 ? (str(m.currency) ?? "EUR") : null,
      text: [
        type === "0" ? "EU call for tenders" : type === "8" ? "EU cascade funding open call" : type === "2" ? "EuropeAid call for proposals" : "EU grant topic",
        str(m.callTitle), str(m.typesOfAction),
        zones.length ? `Geographical zones: ${zones.join(", ")}` : null,
        plainText(m.description ?? m.beneficiaryAdministration, 1500),
      ].filter(Boolean).join(". "),
      countries: [],
      money_kind: type === "0" ? "contracts" : "grants",
    });
  }
  return out;
}

/** Words that say a call is open beyond Europe, for a client who is not there. */
const BEYOND_EUROPE = /\b(africa|african|third countr(y|ies)|international partnerships?|europeaid|low[- ]and[- ]middle[- ]income|lmics?|global south|developing countries|partner countries|least developed)\b/i;

/**
 * Is this worth showing to this client at all?
 *
 * The EU index answers a phrase like "capacity building" with Horizon topics
 * for European consortia, which a consultancy in Nairobi cannot lead. Unless
 * the client is in or works in Europe, an EU row stays only when it names a
 * place the client works or says it is open beyond Europe. World Bank rows are
 * already searched by the client's own countries, so they all stay.
 */
export function keepForProfile(o: OpenOpportunity, p: EligibilityProfile): boolean {
  if (o.source !== "eu_ft") return true;
  const europe = REGIONS.find(r => r.key === "europe")!.members;
  const inEurope = profileCountries(p).some(c => europe.includes(c)) || (p.regions_served ?? []).includes("europe");
  if (inEurope) return true;
  return !!placeNamed(`${o.title}. ${o.text}`, p) || BEYOND_EUROPE.test(`${o.title} ${o.text}`);
}

/** An open opportunity in the shape the screen and the overlay merge expect. */
export function toGrantCard(o: OpenOpportunity): GrantCard & { id: string; money_kind: FundingKind; currency: string | null; source: string } {
  return {
    id: o.id,
    title: o.title,
    opportunity_number: o.id,
    agency: o.funder ?? undefined,
    source_site: SOURCE_LABEL[o.source],
    eligibility: o.text,
    close_date: o.close_date ?? undefined,
    max_award: o.award ?? undefined,
    website: o.url,
    money_kind: o.money_kind,
    currency: o.currency,
    source: o.source,
  };
}

// ---------------------------------------------------------------------------
// IATI: funders active in a country
// ---------------------------------------------------------------------------

/** Solr escaping for a phrase inside double quotes. */
function solrPhrase(s: string): string {
  return `"${s.replace(/["\\]/g, " ").trim()}"`;
}

/**
 * The activity query: in these countries, running OR in the pipeline (status 1,
 * "identification": money a funder has planned but not yet spent, which is the
 * nearest IATI comes to an upcoming call), about these things. Field names are
 * IATI's published Datastore names.
 */
export function iatiQuery(countries: string[], phrases: string[]): string {
  const where = `recipient_country_code:(${countries.map(c => c.toUpperCase()).join(" OR ")})`;
  const about = phrases.length
    ? ` AND (${phrases.map(ph => `title_narrative:${solrPhrase(ph)} OR description_narrative:${solrPhrase(ph)}`).join(" OR ")})`
    : "";
  return `${where} AND activity_status_code:(1 OR 2)${about}`;
}

/** The fields asked for; the decoder reads nothing else. */
export const IATI_FIELDS = "iati_identifier,title_narrative,activity_date_iso_date,activity_status_code,recipient_country_code,participating_org_narrative,participating_org_role,participating_org_ref,reporting_org_narrative,reporting_org_ref";

export interface IatiPeer { name: string; ref: string }

export interface IatiFunder {
  /** "iati:<org ref>" or "iati:<slug of name>". Never an EIN, never collides with one. */
  funder_id: string;
  name: string;
  activities: { title: string; year: string | null }[];
  activity_count: number;
  countries: string[];
  /**
   * Organizations this funder pays to do the work (IATI role 4, implementing):
   * the client's peers. Patch 8: they turn "funds work here" into "already
   * funds organizations like yours", and their UK registration numbers are
   * how 360Giving is searched (patch 9).
   */
  peers: IatiPeer[];
  /** Activities still in the pipeline (status 1): money planned, not yet spent. */
  planned: { title: string; year: string | null }[];
}

const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(x => (typeof x === "string" ? x : "")) : typeof v === "string" ? [v] : [];

/**
 * Funding organizations behind the activities returned, ranked by how many.
 *
 * A participating organization with role 1 is a funder in IATI's code list;
 * the reporting organization is often an implementer reporting its own work,
 * so it is only used when the activity names no funder at all. Role 4
 * (implementing) organizations are kept as the funder's peers.
 */
export function decodeIatiFunders(json: unknown, max = 15): IatiFunder[] {
  const docs = (json as { response?: { docs?: unknown } })?.response?.docs;
  if (!Array.isArray(docs)) return [];
  const by = new Map<string, IatiFunder>();
  for (const raw of docs) {
    const d = raw as Record<string, unknown>;
    const title = arr(d.title_narrative)[0]?.trim() || "Untitled activity";
    const year = (arr(d.activity_date_iso_date)[0] ?? "").slice(0, 4) || null;
    const countries = arr(d.recipient_country_code).map(c => c.toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c));
    const pipeline = String(arr(d.activity_status_code)[0] ?? d.activity_status_code ?? "") === "1";
    const names = arr(d.participating_org_narrative);
    const roles = arr(d.participating_org_role);
    const refs = arr(d.participating_org_ref);
    let funders: IatiPeer[] = [];
    const implementers: IatiPeer[] = [];
    names.forEach((n, i) => {
      if (!n.trim()) return;
      if (roles[i] === "1") funders.push({ name: n.trim(), ref: (refs[i] ?? "").trim() });
      if (roles[i] === "4") implementers.push({ name: n.trim(), ref: (refs[i] ?? "").trim() });
    });
    if (!funders.length) {
      const rn = arr(d.reporting_org_narrative)[0]?.trim();
      if (rn) funders = [{ name: rn, ref: (str(d.reporting_org_ref) ?? "").trim() }];
    }
    for (const f of funders) {
      const key = f.ref ? f.ref.toLowerCase() : f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const id = `iati:${key}`.slice(0, 200);
      const row = by.get(id) ?? { funder_id: id, name: f.name.slice(0, 300), activities: [], activity_count: 0, countries: [], peers: [], planned: [] };
      row.activity_count += 1;
      if (pipeline) {
        if (row.planned.length < 6 && !row.planned.some(a => a.title === title)) row.planned.push({ title: title.slice(0, 200), year });
      } else if (row.activities.length < 12 && !row.activities.some(a => a.title === title)) {
        row.activities.push({ title: title.slice(0, 200), year });
      }
      for (const c of countries) if (!row.countries.includes(c)) row.countries.push(c);
      for (const pe of implementers) {
        // A funder implementing its own work is not its own peer.
        if (pe.name.toLowerCase() === f.name.toLowerCase()) continue;
        if (row.peers.length < 12 && !row.peers.some(x => x.name.toLowerCase() === pe.name.toLowerCase())) row.peers.push(pe);
      }
      by.set(id, row);
    }
  }
  return [...by.values()].sort((a, b) => b.activity_count - a.activity_count || a.name.localeCompare(b.name)).slice(0, max);
}

/**
 * UK-registered peers, as the organization ids 360Giving uses ("GB-CHC-202918",
 * "GB-SC-SC012345", "GB-COH-01234567"), which IATI writes the same way.
 */
export function ukPeerIds(funders: IatiFunder[], max = 8): string[] {
  const out: string[] = [];
  for (const f of funders) for (const p of f.peers) {
    const id = p.ref.toUpperCase().replace(/\s+/g, "");
    if (/^GB-(CHC|SC|NIC|COH)-[A-Z0-9]+$/.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) return out;
  }
  return out;
}

/**
 * IATI funders as rows of "Funders worth approaching".
 *
 * What the row claims is narrow and says so: this organization funds running
 * activities in the client's countries on related themes. It is a record of
 * money moving, not an invitation, so access is unknown and the caveat says to
 * find the funder's country programme or open call before writing.
 */
export function iatiFunderRows(funders: IatiFunder[]): FunderRow[] {
  return funders.map(f => {
    const where = f.countries.map(c => COUNTRY_NAME[c] ?? c).slice(0, 4).join(", ");
    const running = f.activity_count - f.planned.length;
    const plannedLine = f.planned.length
      ? ` It is also planning ${f.planned.length} more (${f.planned.slice(0, 2).map(p => `"${p.title}"${p.year ? `, ${p.year}` : ""}`).join("; ")}), which is the time to make contact.`
      : "";
    return {
      funder_id: f.funder_id, ein: null, name: f.name, website: null,
      location: null, focus: null, mission: null, typical_grant_range: null,
      match_reason: `Funds ${running} running activit${running === 1 ? "y" : "ies"}${where ? ` in ${where}` : ""} on related themes, according to international aid data (IATI).${plannedLine}`,
      confidence: null,
      caveat: "A record of funding, not an open call. Find their country programme, call for proposals or local office before approaching.",
      // Peers first: "already funds organizations like yours" is the stronger
      // reason to write. Without peers, the activities themselves.
      evidence: f.peers.length
        ? f.peers.map(p => ({ name: p.name }))
        : f.activities.map(a => ({ name: a.title, ...(a.year ? { latest_year: a.year } : {}) })),
      evidence_count: f.peers.length || f.activity_count,
      from_graph: f.peers.length > 0, from_overlay: false,
      access_mode: "unknown", access_note: null, access_verified: false,
      has_grant_history: true, verified_at: null,
      source: "iati",
    };
  });
}

// ---------------------------------------------------------------------------
// 360Giving: UK funders of the client's peers (patch 9)
// ---------------------------------------------------------------------------
//
// 360Giving's public API (api.threesixtygiving.org/api/v1) looks organizations
// up by id; it has no search. So it is asked a narrow, strong question: who
// has given grants to the UK-registered organizations IATI shows doing this
// work in the client's countries (ukPeerIds)? Those funders already back
// organizations like the client. Searching all 360Giving grants by place or
// theme needs 360Giving Datastore access, which is granted on request.

export interface ThreeSixtyGrant {
  funderId: string; funderName: string; recipientId: string; recipientName: string;
  amount: number | null; currency: string | null; year: string | null; title: string | null;
}

/** grants_received for one organization, flattened. Anything malformed is skipped. */
export function decode360Received(json: unknown): ThreeSixtyGrant[] {
  const list = (json as { results?: unknown })?.results;
  if (!Array.isArray(list)) return [];
  const out: ThreeSixtyGrant[] = [];
  for (const raw of list) {
    const d = (raw as { data?: Record<string, unknown> })?.data;
    if (!d) continue;
    const funders = Array.isArray(d.fundingOrganization) ? d.fundingOrganization as { id?: string; name?: string }[] : [];
    const recips = Array.isArray(d.recipientOrganization) ? d.recipientOrganization as { id?: string; name?: string }[] : [];
    const f = funders[0];
    if (!f?.id || !f.name) continue;
    const amount = typeof d.amountAwarded === "number" ? Math.round(d.amountAwarded) : Number(d.amountAwarded);
    out.push({
      funderId: f.id, funderName: f.name.trim(),
      recipientId: recips[0]?.id ?? "", recipientName: recips[0]?.name?.trim() ?? "",
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      currency: typeof d.currency === "string" ? d.currency : null,
      year: typeof d.awardDate === "string" ? d.awardDate.slice(0, 4) : null,
      title: typeof d.title === "string" ? d.title.slice(0, 200) : null,
    });
  }
  return out;
}

export interface ThreeSixtyFunder {
  funder_id: string; name: string;
  /** Peers this funder has granted to, newest grant first. */
  grants: { recipient: string; amount: number | null; currency: string | null; year: string | null }[];
  peerCount: number;
}

/**
 * Funders of the peers, ranked by how many different peers they fund, then by
 * how recently. Grants older than `sinceYear` are left out: a funder that last
 * gave in 2009 is history, not a prospect.
 */
export function threeSixtyFunders(grants: ThreeSixtyGrant[], peerIds: string[], sinceYear = 2018, max = 12): ThreeSixtyFunder[] {
  const peers = new Set(peerIds.map(x => x.toUpperCase()));
  const by = new Map<string, ThreeSixtyFunder & { recipients: Set<string>; latest: string }>();
  for (const g of grants) {
    if (peers.has(g.funderId.toUpperCase())) continue;          // a peer funding another peer is not a funder lead
    if (!g.year || Number(g.year) < sinceYear) continue;
    const id = `360g:${g.funderId}`.slice(0, 200);
    const row = by.get(id) ?? { funder_id: id, name: g.funderName.slice(0, 300), grants: [], peerCount: 0, recipients: new Set<string>(), latest: "0" };
    row.grants.push({ recipient: g.recipientName, amount: g.amount, currency: g.currency, year: g.year });
    // One charity can appear under its charity and its company number, so count by name.
    row.recipients.add(g.recipientName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() || g.recipientId);
    if (g.year > row.latest) row.latest = g.year;
    by.set(id, row);
  }
  return [...by.values()]
    .map(r => ({ ...r, peerCount: r.recipients.size, grants: r.grants.sort((a, b) => (b.year ?? "").localeCompare(a.year ?? "")) }))
    .sort((a, b) => b.peerCount - a.peerCount || b.latest.localeCompare(a.latest) || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(({ recipients: _r, latest: _l, ...rest }) => rest);
}

function moneyShort(n: number, currency: string | null): string {
  const c = (currency ?? "GBP").toUpperCase();
  const sym = c === "GBP" ? "£" : c === "USD" ? "$" : c === "EUR" ? "€" : `${c} `;
  return n >= 1_000_000 ? `${sym}${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${sym}${Math.round(n / 1000)}K` : `${sym}${n}`;
}

/** "£16K to £150K", from the amounts on record, or null. */
export function rangeText(amounts: { amount: number | null; currency: string | null }[]): string | null {
  const xs = amounts.filter(a => a.amount != null) as { amount: number; currency: string | null }[];
  if (!xs.length) return null;
  const cur = xs[0].currency;
  const same = xs.filter(x => x.currency === cur).map(x => x.amount);
  const lo = Math.min(...same), hi = Math.max(...same);
  return lo === hi ? moneyShort(hi, cur) : `${moneyShort(lo, cur)} to ${moneyShort(hi, cur)}`;
}

export function threeSixtyFunderRows(funders: ThreeSixtyFunder[], where: string): FunderRow[] {
  return funders.map(f => {
    const seen = new Set<string>();
    const names = f.grants.map(g => g.recipient).filter(n => {
      const k = n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!k || seen.has(k)) return false;
      seen.add(k); return true;
    });
    return {
      funder_id: f.funder_id, ein: null, name: f.name, website: null,
      location: "United Kingdom", focus: null, mission: null,
      typical_grant_range: rangeText(f.grants),
      match_reason: `Has given grants to ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}: organizations doing related work${where ? ` in ${where}` : ""}, according to UK open grants data (360Giving).`,
      confidence: null,
      caveat: null,
      evidence: f.grants.slice(0, 12).map(g => ({ name: g.recipient, ...(g.year ? { latest_year: g.year } : {}) })),
      evidence_count: f.grants.length,
      from_graph: true, from_overlay: false,
      access_mode: "unknown", access_note: null, access_verified: false,
      has_grant_history: true, verified_at: null,
      source: "threesixty",
    };
  });
}
