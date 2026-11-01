import "server-only";
// Fetching the public international sources (patch 4 of the 1 Nov 2026 build).
// What each source is and how its answers are read: lib/open-data.ts.
//
// Every call has its own time limit and its own failure: a source that is down
// costs its own rows, never the run. A match run has 60 seconds in all, so
// these go out in parallel with Ground Truth's calls, not after them.
import {
  decodeWorldBank, decodeSedia, decodeIatiFunders, iatiQuery, worldBankTerm, IATI_FIELDS,
  decode360Received, threeSixtyFunders, ukPeerIds,
  type OpenOpportunity, type OpenPlan, type IatiFunder, type ThreeSixtyFunder,
} from "@/lib/open-data";
import { COUNTRY_NAME } from "@/lib/countries";

const TIMEOUT_MS = 20_000;
const WB_URL = "https://search.worldbank.org/api/v2/procnotices";
const SEDIA_URL = "https://api.tech.ec.europa.eu/search-api/prod/rest/search";
const IATI_URL = "https://api.iatistandard.org/datastore/activity/select";

/** One line per call, for the run record: what was asked and what came back. */
export interface OpenCall { source: "worldbank" | "eu_ft" | "iati" | "threesixty" | "canada"; text: string; ok: boolean; results: number; note?: string }

export interface OpenResults {
  opportunities: OpenOpportunity[];
  funders: IatiFunder[];
  /** UK funders of the IATI peers (patch 9). */
  ukFunders: ThreeSixtyFunder[];
  calls: OpenCall[];
}

export function iatiConfigured(): boolean {
  return !!process.env.IATI_API_KEY;
}

async function worldBank(country: string | null, phrases: string[]): Promise<{ rows: OpenOpportunity[]; call: OpenCall }> {
  const name = country ? COUNTRY_NAME[country] : null;
  const params = new URLSearchParams({
    // 100, not fewer: most recent notices are contract awards, which are dropped.
    format: "json", rows: "100", os: "0", srce: "both",
    // Newest first: an open notice is a recent one, and the decoder drops the rest.
    sort: "submission_date", order: "desc",
  });
  if (phrases.length) params.set("qterm", worldBankTerm(phrases));
  if (name) params.set("project_ctry_name", name);
  const text = `${phrases.join(" | ") || "any"}${name ? ` in ${name}` : ""}`;
  try {
    const res = await fetch(`${WB_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { rows: [], call: { source: "worldbank", text, ok: false, results: 0, note: `answered ${res.status}` } };
    const rows = decodeWorldBank(await res.json());
    return { rows, call: { source: "worldbank", text, ok: true, results: rows.length } };
  } catch (e) {
    console.error("[open-data] World Bank failed", e instanceof Error ? e.message : e);
    return { rows: [], call: { source: "worldbank", text, ok: false, results: 0, note: "did not answer in time" } };
  }
}

async function sedia(types: string[], phrase: string): Promise<{ rows: OpenOpportunity[]; call: OpenCall }> {
  const text = `${phrase} (types ${types.join(",")})`;
  const form = new FormData();
  // 31094501 forthcoming, 31094502 open. The index still marks old calls open;
  // the decoder checks every deadline itself.
  form.append("query", new Blob([JSON.stringify({ bool: { must: [
    { terms: { type: types } }, { terms: { status: ["31094501", "31094502"] } },
  ] } })], { type: "application/json" }));
  form.append("languages", new Blob([JSON.stringify(["en"])], { type: "application/json" }));
  const params = new URLSearchParams({ apiKey: "SEDIA", text: phrase, pageSize: "50", pageNumber: "1" });
  try {
    const res = await fetch(`${SEDIA_URL}?${params}`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return { rows: [], call: { source: "eu_ft", text, ok: false, results: 0, note: `answered ${res.status}` } };
    const rows = decodeSedia(await res.json());
    return { rows, call: { source: "eu_ft", text, ok: true, results: rows.length } };
  } catch (e) {
    console.error("[open-data] EU portal failed", e instanceof Error ? e.message : e);
    return { rows: [], call: { source: "eu_ft", text, ok: false, results: 0, note: "did not answer in time" } };
  }
}

async function iati(countries: string[], phrases: string[]): Promise<{ funders: IatiFunder[]; call: OpenCall }> {
  const text = `funders in ${countries.join(", ")}${phrases.length ? ` on ${phrases.join(" | ")}` : ""}`;
  const key = process.env.IATI_API_KEY;
  if (!key) return { funders: [], call: { source: "iati", text, ok: false, results: 0, note: "skipped: IATI_API_KEY is not set" } };
  const params = new URLSearchParams({
    q: iatiQuery(countries, phrases), rows: "200", wt: "json",
    fl: IATI_FIELDS,
  });
  try {
    const res = await fetch(`${IATI_URL}?${params}`, {
      headers: { "Ocp-Apim-Subscription-Key": key }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
    });
    if (!res.ok) return { funders: [], call: { source: "iati", text, ok: false, results: 0, note: `answered ${res.status}` } };
    const funders = decodeIatiFunders(await res.json());
    return { funders, call: { source: "iati", text, ok: true, results: funders.length } };
  } catch (e) {
    console.error("[open-data] IATI failed", e instanceof Error ? e.message : e);
    return { funders: [], call: { source: "iati", text, ok: false, results: 0, note: "did not answer in time" } };
  }
}

const THREESIXTY_URL = "https://api.threesixtygiving.org/api/v1/org";

/**
 * Who has funded these UK-registered peers (patch 9). One call per peer, in
 * parallel, each with a short limit: this runs after IATI, inside a 60-second
 * match run.
 */
async function threeSixty(peerIds: string[]): Promise<{ funders: ThreeSixtyFunder[]; call: OpenCall }> {
  const text = `funders of ${peerIds.length} UK-registered peer${peerIds.length === 1 ? "" : "s"}`;
  if (!peerIds.length) return { funders: [], call: { source: "threesixty", text, ok: true, results: 0, note: "no UK-registered peers to look up" } };
  const all = await Promise.all(peerIds.map(async id => {
    try {
      const res = await fetch(`${THREESIXTY_URL}/${encodeURIComponent(id)}/grants_received/?limit=100`, {
        signal: AbortSignal.timeout(12_000), cache: "no-store",
      });
      if (!res.ok) return { ok: res.status === 404, rows: [] };   // 404: the peer has no 360Giving record
      return { ok: true, rows: decode360Received(await res.json()) };
    } catch { return { ok: false, rows: [] }; }
  }));
  const funders = threeSixtyFunders(all.flatMap(a => a.rows), peerIds);
  const ok = all.some(a => a.ok);
  return { funders, call: { source: "threesixty", text, ok, results: funders.length, ...(ok ? {} : { note: "did not answer in time" }) } };
}

/** Run every source the plan asks for, in parallel. Never throws. */
export async function searchOpenSources(plan: OpenPlan, phrases: string[]): Promise<OpenResults> {
  const jobs: Promise<{ rows?: OpenOpportunity[]; funders?: IatiFunder[]; call: OpenCall }>[] = [];
  if (plan.worldbank) {
    const cs = plan.worldbank.countries.length ? plan.worldbank.countries : [null];
    for (const c of cs) jobs.push(worldBank(c, phrases));
  }
  if (plan.eu) for (const ph of (phrases.length ? phrases : ["development"]).slice(0, 3)) jobs.push(sedia(plan.eu.types, ph));
  // IATI then 360Giving: the second needs the first's UK-registered peers.
  let ukFunders: ThreeSixtyFunder[] = [];
  const extraCalls: OpenCall[] = [];
  if (plan.iati) jobs.push(iati(plan.iati.countries, phrases).then(async r => {
    if (!r.funders.length) return r;
    const t = await threeSixty(ukPeerIds(r.funders));
    ukFunders = t.funders;
    extraCalls.push(t.call);
    return r;
  }));

  const done = await Promise.all(jobs);
  const seen = new Set<string>();
  const opportunities: OpenOpportunity[] = [];
  for (const d of done) for (const o of d.rows ?? []) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    opportunities.push(o);
  }
  return {
    opportunities,
    funders: done.flatMap(d => d.funders ?? []),
    ukFunders,
    calls: [...done.map(d => d.call), ...extraCalls],
  };
}
