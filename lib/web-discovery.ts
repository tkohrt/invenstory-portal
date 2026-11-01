// Finding current opportunities and funders on the web (patch 5 of the 1
// November 2026 build).
//
// Ground Truth and the public sources are databases: good at who has funded
// what, weak at what is open this month. Tyler covered that by running a deep
// research report beside every match and merging the two by hand. This is that
// second half inside the portal: a few web searches seeded from the client's
// own profile, each answer checked against the pages the search actually
// returned, kept for this client, and filed into the Ground Truth review queue
// as a PROPOSAL. Nothing found here reaches another client until a person has
// approved it, and even then only where it fits (additionFits).
//
// Pure and free of `server-only`; the calls are lib/server/discovery.ts.
import {
  kindsSought, homeLabel, reachLabels, profileCountries, ORG_TYPES, FUNDING_KIND_LABEL,
  type EligibilityProfile, type FundingKind,
} from "@/lib/eligibility-fields";
import { COUNTRY_NAME, REGIONS } from "@/lib/countries";
import { untrusted } from "@/lib/untrusted";

// ---------------------------------------------------------------------------
// What to ask
// ---------------------------------------------------------------------------

export type AngleKind = FundingKind | "funders";

export interface Angle { key: string; kind: AngleKind; question: string }

/** At most this many searches a run: each is a model call and up to three web searches. */
export const MAX_ANGLES = 4;
export const SEARCHES_PER_ANGLE = 3;

/** Where the client works, as a phrase: "in Kenya, Uganda and East Africa". */
export function placePhrase(p: EligibilityProfile): string {
  const places = [...new Set([homeLabel(p) ?? "", ...reachLabels(p)].filter(Boolean))];
  // A US state code reads badly in a web query; the state is enough context.
  if (!places.length) return "";
  if (places.length === 1) return ` in ${places[0]}`;
  return ` in ${places.slice(0, -1).join(", ")} and ${places[places.length - 1]}`;
}

/**
 * The questions for one run, in the order the client's kinds were chosen, plus
 * one about funders when they want grants (most foundations post no call).
 */
export function discoveryAngles(p: EligibilityProfile, identity: string, work: string): Angle[] {
  const where = placePhrase(p);
  const who = identity || (ORG_TYPES.find(t => t.v === p.org_type)?.l.toLowerCase() ?? "organization");
  const what = work || p.cause_areas.join(", ") || "its mission";
  const out: Angle[] = [];
  for (const k of kindsSought(p)) {
    if (k === "grants") out.push({ key: "grants", kind: "grants",
      question: `Grants and calls for proposals open now or opening soon for a ${who} working on ${what}${where}.` });
    if (k === "contracts") out.push({ key: "contracts", kind: "contracts",
      question: `Current requests for proposals, tenders or expressions of interest that a ${who} offering ${what} could bid on${where}.` });
    if (k === "programs") out.push({ key: "programs", kind: "programs",
      question: `Accelerators, prizes, competitions or fellowships accepting applications now from a ${who} working on ${what}${where}.` });
    if (k === "investment") out.push({ key: "investment", kind: "investment",
      question: `Impact investors, recoverable grants or programme-related investment open to a ${who} working on ${what}${where}.` });
  }
  if (kindsSought(p).includes("grants")) out.push({ key: "funders", kind: "funders",
    question: `Foundations and other funders actively funding ${what}${where}, and how each accepts requests.` });
  return out.slice(0, MAX_ANGLES);
}

export const DISCOVER_SYSTEM = `You research funding for For Granted, a grants consultancy, on behalf of one client organization.

Search the web for the question you are given and return what you find as JSON. Rules, in order of importance:
1. Only include an item whose page you actually found in your search results, and give that page's exact URL. Never construct, guess or shorten a URL.
2. Opportunities must be open now or opening soon. Leave out anything whose deadline has passed. If the page gives no deadline, say "rolling" only when the page says applications are rolling or ongoing; otherwise null.
3. Prefer the funder's own page over a listing site or news article. Leave out paywalled aggregators.
4. Say what the page says. Do not invent amounts, deadlines or eligibility. If unsure, use null.
5. "why" is one sentence on why it could fit this client, using only the client facts given. "quote" is a short exact phrase (under 20 words) copied from the page that shows it is real and current.
6. At most 8 items. Fewer good items beat more weak ones. No em dashes.

Return ONLY this JSON, no other text:
{"leads":[{"kind":"opportunity"|"funder","money_kind":"grants"|"contracts"|"programs"|"investment","title":"...","funder":"...","url":"https://...","deadline":"YYYY-MM-DD"|"rolling"|null,"amount":"..."|null,"geography":"..."|null,"eligibility":"..."|null,"why":"...","quote":"..."}]}`;

/** The user turn: today's date, the client in brief (fenced), the question. */
export function discoverUser(angle: Angle, facts: string[], today: string): string {
  return [
    `Today is ${today}.`,
    `The client, as For Granted knows it:`,
    untrusted("CLIENT_CONTEXT", facts.join("\n")),
    `Question: ${angle.question}`,
    angle.kind === "funders"
      ? `Return funders (kind "funder"), each with its own website as the URL and how it accepts requests in "eligibility".`
      : `Return opportunities (kind "opportunity") with money_kind "${angle.kind}".`,
  ].join("\n\n");
}

/** What the model is told about the client: the eligibility facts and a few of the search profile's. */
export function clientFacts(p: EligibilityProfile, orgName: string, profileLines: string[]): string[] {
  return [
    `Name: ${orgName}`,
    `Type: ${ORG_TYPES.find(t => t.v === p.org_type)?.l ?? "unspecified"}`,
    homeLabel(p) ? `Based in: ${homeLabel(p)}` : null,
    reachLabels(p).length ? `Works in: ${reachLabels(p).join(", ")}` : null,
    p.cause_areas.length ? `Cause areas: ${p.cause_areas.join(", ")}` : null,
    p.populations.length ? `Serves: ${p.populations.join(", ")}` : null,
    `Looking for: ${kindsSought(p).map(k => FUNDING_KIND_LABEL[k].toLowerCase()).join(", ")}`,
    ...profileLines.slice(0, 8),
  ].filter(Boolean) as string[];
}

// ---------------------------------------------------------------------------
// Reading and checking the answer
// ---------------------------------------------------------------------------

/** A page the search actually returned, which is what a lead must point at. */
export interface WebSource { url: string; title: string | null; pageAge: string | null }

export type SearchBlock = { type: string; text?: string; content?: unknown; citations?: unknown };

/** Pages from search results and citations, de-duplicated by URL. */
export function sourcesFrom(blocks: SearchBlock[]): WebSource[] {
  const out = new Map<string, WebSource>();
  for (const b of blocks) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as { type?: string; url?: string; title?: string; page_age?: string }[]) {
        if (r?.type === "web_search_result" && typeof r.url === "string") {
          out.set(r.url, { url: r.url, title: r.title ?? null, pageAge: r.page_age ?? null });
        }
      }
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations as { url?: string; title?: string }[]) {
        if (typeof c?.url === "string" && !out.has(c.url)) out.set(c.url, { url: c.url, title: c.title ?? null, pageAge: null });
      }
    }
  }
  return [...out.values()];
}


export interface RawLead {
  kind?: unknown; money_kind?: unknown; title?: unknown; funder?: unknown; url?: unknown;
  deadline?: unknown; amount?: unknown; geography?: unknown; eligibility?: unknown; why?: unknown; quote?: unknown;
}

export interface Lead {
  kind: "opportunity" | "funder";
  money_kind: FundingKind;
  title: string;
  funder: string | null;
  url: string;
  url_key: string;
  deadline: string | null;
  rolling: boolean;
  amount: string | null;
  geography: string | null;
  eligibility: string | null;
  why: string | null;
  quote: string | null;
  /** exact: the URL is a page the search returned. site: only its website was. */
  grounded: "exact" | "site";
}

/** The JSON object in a reply, tolerating a fence or a sentence around it. */
export function parseLeads(text: string): RawLead[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { leads?: unknown };
    return Array.isArray(obj.leads) ? obj.leads.filter(l => l && typeof l === "object") as RawLead[] : [];
  } catch { return []; }
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$)/i;

/** One key per page: lower-case host, no www, no tracking, fragment or trailing slash. */
export function urlKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const path = u.pathname.replace(/\/+$/, "") || "";
  return `${host}${path}${q}`;
}

function hostOf(key: string): string { return key.split("/")[0]; }

const s = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, max) : null;

const KINDS: readonly FundingKind[] = ["grants", "contracts", "programs", "investment"];

/**
 * Model-written text a client reads carries no links of its own (the security
 * rule from Patch 2): the lead's one link is its checked URL, shown separately.
 */
export function noLinks(text: string | null): string | null {
  if (!text) return text;
  const t = text.replace(/\bhttps?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "").replace(/\s{2,}/g, " ").trim();
  return t || null;
}

/**
 * Keep only what can be stood behind.
 *
 * A lead is kept when its URL is a page the search returned ("exact"), or sits
 * on a site the search returned ("site", shown to For Granted only, with a
 * note to check the link). Anything else is dropped unseen: a model that
 * invents a plausible deadline page is the failure this exists to stop. Past
 * deadlines are dropped; duplicates within the answer are dropped.
 */
export function groundLeads(raw: RawLead[], sourceUrls: string[], angleKind: AngleKind, today: string): Lead[] {
  const exact = new Set(sourceUrls.map(urlKey).filter(Boolean) as string[]);
  const hosts = new Set([...exact].map(hostOf));
  const out: Lead[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const url = s(r.url, 1000);
    const key = url ? urlKey(url) : null;
    if (!url || !key || seen.has(key)) continue;
    const grounded = exact.has(key) ? "exact" : hosts.has(hostOf(key)) ? "site" : null;
    if (!grounded) continue;
    const title = s(r.title, 300);
    if (!title) continue;
    const d = s(r.deadline, 20);
    const rolling = !!d && /rolling|ongoing|open/i.test(d);
    const deadline = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(new Date(d).getTime()) ? d : null;
    if (deadline && deadline < today) continue;
    const kind = r.kind === "funder" || angleKind === "funders" ? "funder" : "opportunity";
    const mk = typeof r.money_kind === "string" && (KINDS as readonly string[]).includes(r.money_kind)
      ? r.money_kind as FundingKind
      : angleKind === "funders" ? "grants" : angleKind as FundingKind;
    seen.add(key);
    out.push({
      kind, money_kind: mk, title, funder: s(r.funder, 200), url, url_key: key,
      deadline, rolling, amount: noLinks(s(r.amount, 120)), geography: noLinks(s(r.geography, 200)),
      eligibility: noLinks(s(r.eligibility, 600)), why: noLinks(s(r.why, 400)), quote: noLinks(s(r.quote, 200)),
      grounded,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Into the Ground Truth review queue
// ---------------------------------------------------------------------------

/** "$50,000" or "EUR 1.2 million" as a whole number, when it is clearly one figure. */
export function amountNumber(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(million|m\b|k\b|thousand)?/i);
  if (!m) return null;
  let n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit.startsWith("m")) n *= 1_000_000; else if (unit === "k" || unit === "thousand") n *= 1_000;
  return Number.isFinite(n) && n >= 100 ? Math.round(n) : null;
}

export function currencyOf(text: string | null): string | null {
  if (!text) return null;
  if (/€|\beur(os?)?\b/i.test(text)) return "EUR";
  if (/£|\bgbp\b/i.test(text)) return "GBP";
  if (/\bksh|\bkes\b/i.test(text)) return "KES";
  if (/\$|\busd\b/i.test(text)) return "USD";
  return null;
}

/** Country codes a lead's geography names, so another client's run can tell if it fits. */
export function geographyCodes(text: string | null): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const [code, name] of Object.entries(COUNTRY_NAME)) {
    if (new RegExp(`(^|[^a-z])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`).test(t)) out.push(code);
  }
  for (const r of REGIONS) if (r.key !== "global" && t.includes(r.label.toLowerCase())) out.push(`region:${r.key}`);
  return out;
}

export interface OverlayDraft {
  kind: "grant" | "funder";
  title: string;
  source_url: string;
  fields: Record<string, unknown>;
}

/**
 * A lead as a Ground Truth proposal. The fields use the record's own names, so
 * once approved it merges and screens like any other record (title, agency,
 * eligibility, close_date, max_award, website for an opportunity; name,
 * website, focus, access_note for a funder). `discovered_via` marks it for
 * additionFits; `notes` is For Granted's and never reaches a client.
 */
export function overlayDraft(l: Lead, topics: string[]): OverlayDraft {
  const geography = geographyCodes(l.geography);
  const notes = [l.why ? `Why it came up: ${l.why}` : null, l.quote ? `Page says: "${l.quote}"` : null,
    l.grounded === "site" ? "The exact page was not among the search results: check the link." : null].filter(Boolean).join(" ");
  if (l.kind === "funder") {
    return {
      kind: "funder", title: l.funder ?? l.title, source_url: l.url,
      fields: {
        name: l.funder ?? l.title, website: l.url,
        ...(l.eligibility ? { access_note: l.eligibility } : {}),
        ...(l.geography ? { location: l.geography } : {}),
        focus: topics.join(", ") || null,
        discovered_via: "web", geography, topics, ...(notes ? { notes } : {}),
      },
    };
  }
  const amount = amountNumber(l.amount);
  return {
    kind: "grant", title: l.title, source_url: l.url,
    fields: {
      title: l.title, website: l.url, opportunity_number: l.url,
      ...(l.funder ? { agency: l.funder } : {}),
      eligibility: [l.eligibility, l.geography ? `Geography: ${l.geography}` : null].filter(Boolean).join(". ") || null,
      ...(l.deadline ? { close_date: l.deadline } : {}),
      ...(amount ? { max_award: amount, currency: currencyOf(l.amount) ?? "USD" } : {}),
      money_kind: l.money_kind, source: "web",
      discovered_via: "web", geography, topics, ...(notes ? { notes } : {}),
    },
  };
}

/**
 * Should an approved web find join THIS client's run?
 *
 * Approved Ground Truth additions reach every client's run. For records a
 * person entered that is right; for web finds it would put a Nairobi tender in
 * an Ohio youth charity's list. So a web find joins only a client it fits: the
 * one it was found for, or one whose places overlap its geography (none given
 * means anywhere) AND whose cause areas share a word with its topics or text.
 * Records without `discovered_via` are untouched.
 */
export function additionFits(
  row: { surfaced_for_tenant?: string | null; fields: Record<string, unknown> },
  tenantId: string, p: EligibilityProfile,
): boolean {
  const f = row.fields ?? {};
  if (f.discovered_via !== "web") return true;
  if (row.surfaced_for_tenant === tenantId) return true;
  const geo = Array.isArray(f.geography) ? (f.geography as unknown[]).filter(g => typeof g === "string") as string[] : [];
  if (geo.length) {
    const mine = new Set(profileCountries(p));
    const myRegions = new Set([...(p.regions_served ?? []), ...[...mine].flatMap(c => REGIONS.filter(r => r.members.includes(c)).map(r => r.key))]);
    const placeOk = geo.some(g => g.startsWith("region:") ? myRegions.has(g.slice(7)) : mine.has(g));
    if (!placeOk) return false;
  }
  // No geography stated is fine for anyone: it may be US-wide or global.
  const words = (xs: string[]) => new Set(xs.join(" ").toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 5));
  const mine = words([...p.cause_areas, ...p.populations]);
  const theirs = words([
    ...(Array.isArray(f.topics) ? f.topics as string[] : []),
    String(f.title ?? ""), String(f.name ?? ""), String(f.eligibility ?? ""), String(f.focus ?? ""),
  ]);
  for (const w of mine) if (theirs.has(w)) return true;
  return false;
}
