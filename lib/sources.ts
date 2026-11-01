// The sources Funder Matches searches, and which are on for a client (patch 11
// of the 1 November 2026 build).
//
// ONE list. The match run, the Sources panel, the Funding Eligibility notes and
// the labels on every match read from it, so a new source (the Open Funder
// Index registers, say) is one entry here plus its search code.
//
// Each source is Automatic, On or Off for a client. Automatic follows the
// Funding Eligibility profile: the kinds of money sought, whether the client
// works outside the US, and whether it has named countries. On and Off are a
// person's choice, and say whose. For Granted can also lock a choice so the
// client cannot change it. Only choices are stored (match_source_setting): a
// source left on Automatic follows the profile when the profile changes.
//
// Pure and free of `server-only`; tested in tests/ledger/sources.test.ts.
import {
  kindsSought, wantsInternational, FUNDING_KIND_LABEL,
  type EligibilityProfile, type FundingKind,
} from "@/lib/eligibility-fields";
import { planOpenSources, searchCountries, MAX_WB_COUNTRIES, MAX_IATI_COUNTRIES, MAX_CANADA_COUNTRIES, type OpenPlan } from "@/lib/open-data";

export type SourceId = "ledger" | "worldbank" | "eu_ft" | "iati" | "threesixty" | "canada" | "web";
export type SourceGroup = "core" | "public" | "web";

export interface SourceDef {
  id: SourceId;
  name: string;
  /** One line: what it holds, in the client's terms. */
  what: string;
  group: SourceGroup;
  /** The kinds of money it can find; "all" for every kind. */
  kinds: FundingKind[] | "all";
  /** Searched only for a client working outside the US. */
  outsideUs: boolean;
  /** Needs the countries the client works in; a region alone is enough. */
  needsCountries?: boolean;
  /** Runs on what another source found. */
  requires?: SourceId;
  /** Costs money each time it runs (the web search). */
  paid?: boolean;
  /** Always searched; cannot be switched off. */
  fixed?: boolean;
  /** A separate button runs it, not Search for funding. */
  ownButton?: boolean;
}

export const SOURCES: readonly SourceDef[] = [
  {
    id: "ledger", name: "Ground Truth", group: "core", kinds: "all", outsideUs: false, fixed: true,
    what: "For Granted's funding database: foundations, government grants and the records our team has reviewed.",
  },
  {
    id: "eu_ft", name: "EU Funding & Tenders Portal", group: "public", kinds: ["grants", "programs", "contracts"], outsideUs: true,
    what: "EU grant calls, EuropeAid calls, cascade funding and EU tenders.",
  },
  {
    id: "iati", name: "International aid data (IATI)", group: "public", kinds: ["grants", "programs"], outsideUs: true, needsCountries: true,
    what: "Aid funders spending in your countries, the organizations they already pay, and money they plan to spend.",
  },
  {
    id: "threesixty", name: "UK grants data (360Giving)", group: "public", kinds: ["grants", "programs"], outsideUs: true, needsCountries: true, requires: "iati",
    what: "UK funders that have given grants to organizations doing work like yours.",
  },
  {
    id: "canada", name: "Government of Canada grants data", group: "public", kinds: ["grants", "programs"], outsideUs: true, needsCountries: true,
    what: "Federal programmes that fund organizations in your countries, such as the Canada Fund for Local Initiatives.",
  },
  {
    id: "worldbank", name: "World Bank procurement notices", group: "public", kinds: ["contracts"], outsideUs: true,
    what: "Tenders and expressions of interest on World Bank financed projects.",
  },
  {
    id: "web", name: "Web search", group: "web", kinds: "all", outsideUs: false, paid: true, ownButton: true,
    what: "Searches the open web for calls and funders the databases miss. Anything it finds is checked by For Granted before other clients see it.",
  },
];

export const SOURCE_BY_ID: Record<SourceId, SourceDef> = Object.fromEntries(SOURCES.map(s => [s.id, s])) as Record<SourceId, SourceDef>;
export const GROUP_LABEL: Record<SourceGroup, string> = {
  core: "Always searched",
  public: "Public sources outside the US",
  web: "The web",
};

export function isSourceId(v: unknown): v is SourceId {
  return typeof v === "string" && SOURCES.some(s => s.id === v);
}

export type SourceMode = "auto" | "on" | "off";
export function isSourceMode(v: unknown): v is SourceMode {
  return v === "auto" || v === "on" || v === "off";
}
export const MODE_LABEL: Record<SourceMode, string> = { auto: "Automatic", on: "On", off: "Off" };

/** A stored choice for one client and one source. */
export interface SourceSetting { mode: SourceMode; locked: boolean; setByRole: "admin" | "client" }

/** Why a source cannot run at all just now, for everyone; null when it can. */
export type Availability = Partial<Record<SourceId, string | null>>;

export interface SourceState {
  id: SourceId;
  name: string;
  what: string;
  group: SourceGroup;
  kindsText: string;
  paid: boolean;
  fixed: boolean;
  ownButton: boolean;
  /** Searched on the next run (for the web: offered on its button). */
  on: boolean;
  /** What Automatic would do. */
  autoOn: boolean;
  mode: SourceMode;
  locked: boolean;
  setByRole: "admin" | "client" | null;
  /** One sentence: why it is on or off. */
  why: string;
  /** Set when the source cannot run whatever anyone chooses. */
  unavailable: string | null;
}

function list(words: string[], joiner: "and" | "or"): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${joiner} ${words[words.length - 1]}`;
}
/** "Contracts and RFPs" becomes "contracts and RFPs": acronyms keep their capitals. */
const lower = (k: FundingKind) => FUNDING_KIND_LABEL[k].replace(/^./, c => c.toLowerCase());

function kindsText(def: SourceDef): string {
  return def.kinds === "all" ? "Every kind of funding" : def.kinds.map(k => FUNDING_KIND_LABEL[k]).join(" · ");
}

/** What Automatic does for this profile, and why, in one sentence. */
export function autoDecision(def: SourceDef, p: EligibilityProfile): { on: boolean; why: string } {
  if (def.fixed) return { on: true, why: "Always searched." };
  if (def.ownButton) return { on: true, why: "Runs only when someone presses Search the web." };
  const sought = kindsSought(p);
  if (def.outsideUs && !wantsInternational(p)) {
    return { on: false, why: "Off because Funding Eligibility shows work in the US only." };
  }
  const fits = def.kinds === "all" ? sought : sought.filter(k => (def.kinds as FundingKind[]).includes(k));
  if (!fits.length) {
    return { on: false, why: `Off because you are not looking for ${list((def.kinds as FundingKind[]).map(lower), "or")}.` };
  }
  if (def.needsCountries && !searchCountries(p, 1).length) {
    return { on: false, why: "Off until Funding Eligibility names the countries or regions you work in." };
  }
  return { on: true, why: `On because you are looking for ${list(fits.map(lower), "and")}${def.outsideUs ? " outside the US" : ""}.` };
}

/**
 * Every source, on or off, with the reason, for this profile and these stored
 * choices. `viewer` only changes whose choice a sentence names.
 */
export function resolveSources(
  p: EligibilityProfile,
  settings: Partial<Record<SourceId, SourceSetting>>,
  availability: Availability = {},
  viewer: "admin" | "client" = "client",
): SourceState[] {
  const whose = (role: "admin" | "client") =>
    role === viewer ? "by you" : role === "admin" ? "by For Granted" : "by the client";
  const states = SOURCES.map((def): SourceState => {
    const auto = autoDecision(def, p);
    const s = def.fixed ? undefined : settings[def.id];
    const mode: SourceMode = s?.mode ?? "auto";
    let on = mode === "on" ? true : mode === "off" ? false : auto.on;
    let why = mode === "auto"
      ? auto.why
      : `${mode === "on" ? "Turned on" : "Turned off"} ${whose(s!.setByRole)}${s!.locked ? " and locked" : ""}.`;
    if (mode === "auto" && s?.locked) why = `${auto.why} Locked to Automatic ${whose(s.setByRole)}.`;
    let unavailable = availability[def.id] ?? null;
    if (!unavailable && on && def.needsCountries && !searchCountries(p, 1).length) {
      unavailable = "Cannot run until Funding Eligibility names the countries or regions you work in.";
    }
    if (unavailable) on = false;
    return {
      id: def.id, name: def.name, what: def.what, group: def.group, kindsText: kindsText(def),
      paid: !!def.paid, fixed: !!def.fixed, ownButton: !!def.ownButton,
      on, autoOn: auto.on, mode, locked: !!s?.locked, setByRole: s?.setByRole ?? null, why, unavailable,
    };
  });
  // A source that runs on another's results is off while that one is.
  for (const st of states) {
    const req = SOURCE_BY_ID[st.id].requires;
    const base = req ? states.find(x => x.id === req) : null;
    if (st.on && base && !base.on) {
      st.on = false;
      st.why = `Needs ${base.name}, which is off.`;
    }
  }
  return states;
}

/** May this person change this source? */
export function canChange(
  st: Pick<SourceState, "fixed" | "locked">,
  who: { role: "admin" | "client"; preview: boolean; selfSearch: boolean },
): boolean {
  if (st.fixed || who.preview) return false;
  if (who.role === "admin") return true;
  return who.selfSearch && !st.locked;
}

/** "Searching 5 of 7 sources". */
export function summaryLine(states: SourceState[]): string {
  const on = states.filter(s => s.on).length;
  return `Searching ${on} of ${states.length} sources`;
}

const EU_TYPES_FOR: Record<FundingKind, string[]> = {
  grants: ["1", "2", "8"], programs: ["8"], contracts: ["0"], investment: [],
};

/**
 * What the match run searches, from the resolved sources. Automatic sources
 * plan exactly as planOpenSources does; a source turned on by hand for a
 * profile that would not have planned it gets the broadest sensible query.
 */
export function planFromSources(p: EligibilityProfile, states: SourceState[]): OpenPlan {
  const on = (id: SourceId) => states.find(s => s.id === id)?.on ?? false;
  const auto = planOpenSources(p);
  const kinds = kindsSought(p);
  const euTypes = [...new Set(kinds.flatMap(k => EU_TYPES_FOR[k]))].sort();
  const iatiCountries = searchCountries(p, MAX_IATI_COUNTRIES);
  const canadaCountries = searchCountries(p, MAX_CANADA_COUNTRIES);
  const iati = on("iati") ? (auto.iati ?? (iatiCountries.length ? { countries: iatiCountries } : null)) : null;
  return {
    worldbank: on("worldbank") ? (auto.worldbank ?? { countries: searchCountries(p, MAX_WB_COUNTRIES) }) : null,
    eu: on("eu_ft") ? (auto.eu ?? { types: euTypes.length ? euTypes : ["0", "1", "2", "8"] }) : null,
    iati,
    threesixty: on("threesixty") && !!iati,
    canada: on("canada") ? (auto.canada ?? (canadaCountries.length ? { countries: canadaCountries } : null)) : null,
  };
}

/** For Funding Eligibility: the public sources a kind of money switches on. */
export function sourcesForKind(kind: FundingKind): string[] {
  return SOURCES.filter(s => s.group === "public" && s.kinds !== "all" && s.kinds.includes(kind)).map(s => s.name);
}

// ---- The last run, per source ----

export interface RunCall { track: string; text: string; ok?: boolean; results?: number }
export interface SourceRun { ok: boolean; results: number; note: string | null }

/**
 * What each source did on the last match run, from the run record. Only
 * outcomes and our own short notes, never the query text, so it is safe to
 * show a client.
 */
export function lastRunBySource(calls: RunCall[]): Partial<Record<SourceId, SourceRun>> {
  const out: Partial<Record<SourceId, SourceRun>> = {};
  const add = (id: SourceId, ok: boolean, results: number, note: string | null) => {
    const prev = out[id];
    out[id] = prev
      ? { ok: prev.ok || ok, results: prev.results + results, note: prev.ok || ok ? null : prev.note ?? note }
      : { ok, results, note: ok ? null : note };
  };
  for (const c of calls) {
    const id: SourceId | null = c.track === "grants" || c.track === "funders" ? "ledger"
      : c.track.startsWith("open:") && isSourceId(c.track.slice(5)) ? c.track.slice(5) as SourceId : null;
    if (!id) continue;
    // Only our own short notes on a public source that did not answer, and
    // never one naming a setting. Ground Truth's text is the query itself.
    const raw = id === "ledger" || c.ok !== false ? null : /\(([^()]{3,80})\)$/.exec(c.text ?? "")?.[1] ?? null;
    const note = raw && !/[A-Z]{2,}_[A-Z_]{2,}|key|env/i.test(raw) ? raw : null;
    add(id, c.ok !== false, c.results ?? 0, note);
  }
  return out;
}

/** "12 results", "no results", "did not answer in time". */
export function runText(r: SourceRun | undefined): string {
  if (!r) return "Not searched on the last run.";
  if (!r.ok) return r.note ? `Last run: ${r.note.replace(/\.$/, "")}.` : "Did not answer on the last run.";
  return r.results ? `${r.results.toLocaleString()} result${r.results === 1 ? "" : "s"} on the last run.` : "No results on the last run.";
}
