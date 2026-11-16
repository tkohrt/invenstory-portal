// Government readiness: the RFP Engine's gate profile (patch 53, 16 Nov 2026).
//
// Plan: project doc "RFP Engine, Portal Integration and Build Plan (16 November
// 2026)", section 2. Six gates decide whether a government solicitation is
// even open to a client: SAM registration, facility clearance, CMMC level,
// FedRAMP posture, a GSA Schedule, and set-aside statuses. They are stored as
// structured answers a person gave (gov_readiness.answers, migration 0094),
// each stamped with who said so and when.
//
// The rules, from the BKL retrospective:
//   - every gate may be answered "to be confirmed";
//   - a gate nobody has answered, or one that is to be confirmed, is UNKNOWN.
//     Unknown screens as "check", never as "fail": never assume a client lacks
//     a credential.
// Pure, so it is tested rather than trusted (tests/portal/gov-readiness.test.ts).

/** The per-client switch: a feature_visibility key, off unless For Granted turns it on. */
export const RFP_ENGINE_KEY = "rfp_engine";

/** The one question every client is asked; a yes raises a request, never the switch. */
export const GOV_INTEREST_QUESTION =
  "Do you sell, or want to sell, to government buyers (federal, state, local, or education)?";

export const TBC = "tbc";
type Opt = { v: string; l: string };

export const SAM_STATUS: Opt[] = [
  { v: "active", l: "Registered and active" },
  { v: "in_progress", l: "Registration in progress" },
  { v: "none", l: "Not registered" },
  { v: TBC, l: "To be confirmed" },
];
export const CLEARANCE_LEVELS: Opt[] = [
  { v: "none", l: "No facility clearance" },
  { v: "confidential", l: "Confidential" },
  { v: "secret", l: "Secret" },
  { v: "top_secret", l: "Top Secret" },
  { v: TBC, l: "To be confirmed" },
];
export const CMMC_LEVELS: Opt[] = [
  { v: "none", l: "No CMMC certification" },
  { v: "level_1", l: "Level 1" },
  { v: "level_2", l: "Level 2" },
  { v: "level_3", l: "Level 3" },
  { v: TBC, l: "To be confirmed" },
];
export const FEDRAMP_POSTURES: Opt[] = [
  { v: "not_applicable", l: "Not applicable (we do not sell a cloud service)" },
  { v: "none", l: "No FedRAMP status" },
  { v: "in_process", l: "In process" },
  { v: "ready", l: "FedRAMP Ready" },
  { v: "authorized", l: "Authorized" },
  { v: TBC, l: "To be confirmed" },
];
export const GSA_STATUS: Opt[] = [
  { v: "held", l: "We hold a Schedule" },
  { v: "applied", l: "Applied, not yet awarded" },
  { v: "teaming", l: "We team with a Schedule holder" },
  { v: "none", l: "No Schedule" },
  { v: TBC, l: "To be confirmed" },
];
export const SET_ASIDES = [
  { v: "small_business", l: "Small business" },
  { v: "eight_a", l: "8(a)" },
  { v: "wosb", l: "Woman-owned small business (WOSB)" },
  { v: "hubzone", l: "HUBZone" },
  { v: "sdvosb", l: "Service-disabled veteran-owned (SDVOSB)" },
] as const;
export type SetAsideKey = (typeof SET_ASIDES)[number]["v"];
export type YesNoTbc = "yes" | "no" | "tbc";
export const YES_NO_TBC: { v: YesNoTbc; l: string }[] = [
  { v: "yes", l: "Yes" }, { v: "no", l: "No" }, { v: "tbc", l: "To be confirmed" },
];

export const GATES = [
  { key: "sam", label: "SAM.gov registration" },
  { key: "clearance", label: "Facility clearance" },
  { key: "cmmc", label: "CMMC level" },
  { key: "fedramp", label: "FedRAMP posture" },
  { key: "gsa_schedule", label: "GSA Schedule" },
  { key: "set_asides", label: "Set-aside statuses" },
] as const;
export type GateKey = (typeof GATES)[number]["key"];

/** Who gave a gate's answer, and when. */
export interface GateStamp { by: string; role: "client" | "admin"; at: string }

export interface GovAnswers {
  sam?: { status: string; uei: string | null; cage: string | null; expires: string | null } & GateStamp;
  clearance?: { level: string } & GateStamp;
  cmmc?: { level: string } & GateStamp;
  fedramp?: { posture: string } & GateStamp;
  gsa_schedule?: { status: string; contract: string | null } & GateStamp;
  set_asides?: { statuses: Partial<Record<SetAsideKey, YesNoTbc>> } & GateStamp;
}

/** What the form sends: the same gates, with no stamps. A gate left out is unanswered. */
export interface GovInput {
  sam?: { status?: string; uei?: string | null; cage?: string | null; expires?: string | null };
  clearance?: { level?: string };
  cmmc?: { level?: string };
  fedramp?: { posture?: string };
  gsa_schedule?: { status?: string; contract?: string | null };
  set_asides?: { statuses?: Partial<Record<string, string>> };
}

const has = (set: Opt[], v: unknown): v is string => typeof v === "string" && set.some(o => o.v === v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The stored answers, read defensively: anything not in the shape above is dropped. */
export function parseGovAnswers(raw: unknown): GovAnswers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const out: GovAnswers = {};
  const stamp = (g: Record<string, unknown>): GateStamp | null =>
    typeof g.by === "string" && (g.role === "client" || g.role === "admin") && typeof g.at === "string"
      ? { by: g.by, role: g.role, at: g.at } : null;
  const content = cleanContent(r as GovInput).content;
  for (const g of GATES) {
    const c = content[g.key], s = r[g.key] && typeof r[g.key] === "object" ? stamp(r[g.key]!) : null;
    if (c && s) (out as Record<string, unknown>)[g.key] = { ...c, ...s };
  }
  return out;
}

type Content = { [K in GateKey]?: Omit<NonNullable<GovAnswers[K]>, keyof GateStamp> };

function cleanContent(input: GovInput): { content: Content; problems: string[] } {
  const content: Content = {};
  const problems: string[] = [];
  const i = (input && typeof input === "object" ? input : {}) as GovInput;

  if (i.sam && has(SAM_STATUS, i.sam.status)) {
    const status = i.sam.status;
    // The identifiers and the date only mean something for a registration that exists.
    const registered = status === "active";
    let uei: string | null = str(i.sam.uei, 20).toUpperCase().replace(/[\s-]/g, "") || null;
    let cage: string | null = str(i.sam.cage, 12).toUpperCase().replace(/[\s-]/g, "") || null;
    let expires: string | null = str(i.sam.expires, 10) || null;
    if (uei && !/^[A-Z0-9]{12}$/.test(uei)) { problems.push("A UEI is 12 letters and numbers. It was left blank; add it again when you have it."); uei = null; }
    if (cage && !/^[A-Z0-9]{5}$/.test(cage)) { problems.push("A CAGE code is 5 letters and numbers. It was left blank; add it again when you have it."); cage = null; }
    if (expires && !isDay(expires)) { problems.push("The SAM expiry date could not be read. It was left blank."); expires = null; }
    content.sam = registered ? { status, uei, cage, expires } : { status, uei: null, cage: null, expires: null };
  }
  if (i.clearance && has(CLEARANCE_LEVELS, i.clearance.level)) content.clearance = { level: i.clearance.level };
  if (i.cmmc && has(CMMC_LEVELS, i.cmmc.level)) content.cmmc = { level: i.cmmc.level };
  if (i.fedramp && has(FEDRAMP_POSTURES, i.fedramp.posture)) content.fedramp = { posture: i.fedramp.posture };
  if (i.gsa_schedule && has(GSA_STATUS, i.gsa_schedule.status)) {
    const status = i.gsa_schedule.status;
    content.gsa_schedule = { status, contract: status === "held" ? str(i.gsa_schedule.contract, 40) || null : null };
  }
  if (i.set_asides && i.set_asides.statuses && typeof i.set_asides.statuses === "object") {
    const statuses: Partial<Record<SetAsideKey, YesNoTbc>> = {};
    for (const s of SET_ASIDES) {
      const v = (i.set_asides.statuses as Record<string, unknown>)[s.v];
      if (v === "yes" || v === "no" || v === "tbc") statuses[s.v] = v;
    }
    if (Object.keys(statuses).length) content.set_asides = { statuses };
  }
  return { content, problems };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a save may store. A gate the form left blank becomes unanswered. A gate
 * whose answer did not change keeps the stamp it had, so the record still says
 * who first gave that answer; a changed or new answer is stamped with whoever
 * is saving now. `problems` are sentences for the person, about values that
 * could not be kept.
 */
export function cleanGovInput(input: GovInput, prior: GovAnswers, who: { by: string; role: "client" | "admin" }, now: Date = new Date()): { answers: GovAnswers; problems: string[]; changed: GateKey[] } {
  const { content, problems } = cleanContent(input);
  const answers: GovAnswers = {};
  const changed: GateKey[] = [];
  for (const g of GATES) {
    const next = content[g.key], had = prior[g.key];
    if (!next) { if (had) changed.push(g.key); continue; }
    const hadContent = had ? Object.fromEntries(Object.entries(had).filter(([k]) => k !== "by" && k !== "role" && k !== "at")) : null;
    if (had && same(orderKeys(hadContent), orderKeys(next))) { (answers as Record<string, unknown>)[g.key] = had; continue; }
    (answers as Record<string, unknown>)[g.key] = { ...next, by: who.by, role: who.role, at: now.toISOString() };
    changed.push(g.key);
  }
  return { answers, problems, changed };
}

function orderKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(orderKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, orderKeys((v as Record<string, unknown>)[k])]));
  return v;
}

/** The answers as the form holds them (no stamps). */
export function toGovInput(a: GovAnswers): GovInput {
  return {
    ...(a.sam ? { sam: { status: a.sam.status, uei: a.sam.uei, cage: a.sam.cage, expires: a.sam.expires } } : {}),
    ...(a.clearance ? { clearance: { level: a.clearance.level } } : {}),
    ...(a.cmmc ? { cmmc: { level: a.cmmc.level } } : {}),
    ...(a.fedramp ? { fedramp: { posture: a.fedramp.posture } } : {}),
    ...(a.gsa_schedule ? { gsa_schedule: { status: a.gsa_schedule.status, contract: a.gsa_schedule.contract } } : {}),
    ...(a.set_asides ? { set_asides: { statuses: { ...a.set_asides.statuses } } } : {}),
  };
}

// ---- What the answers mean (what screenRfp will read) ----

export type GateState = "answered" | "tbc" | "unanswered";

/**
 * Where one gate stands. Set-asides are answered only when all five are yes or
 * no; any left blank or to be confirmed keeps the gate open.
 */
export function gateState(a: GovAnswers, key: GateKey): GateState {
  const g = a[key];
  if (!g) return "unanswered";
  if (key === "set_asides") {
    const st = (g as NonNullable<GovAnswers["set_asides"]>).statuses;
    const vals = SET_ASIDES.map(s => st[s.v]);
    if (vals.every(v => v === "yes" || v === "no")) return "answered";
    return vals.some(v => v === "tbc") || vals.some(Boolean) ? "tbc" : "unanswered";
  }
  const value = key === "sam" ? a.sam!.status : key === "clearance" ? a.clearance!.level : key === "cmmc" ? a.cmmc!.level
    : key === "fedramp" ? a.fedramp!.posture : a.gsa_schedule!.status;
  return value === TBC ? "tbc" : "answered";
}

/** How many of the six gates have a settled answer. */
export function gatesAnswered(a: GovAnswers): number {
  return GATES.filter(g => gateState(a, g.key) === "answered").length;
}

/** A standing the screen can act on: a yes, a no, or "not known, so check". */
export type Standing = "ok" | "blocked" | "check";

/**
 * Can this client bid where an active SAM registration is required?
 *   ok       registered and active, and not past its expiry date
 *   blocked  not registered, still registering, or the date given has passed
 *   check    unanswered or to be confirmed
 * An active registration with no date given is ok: the client said it is active.
 */
export function samStanding(a: GovAnswers, today: Date = new Date()): { standing: Standing; reason: string } {
  const s = a.sam;
  if (!s || s.status === TBC) return { standing: "check", reason: "SAM.gov registration has not been confirmed." };
  if (s.status === "none") return { standing: "blocked", reason: "Not registered in SAM.gov." };
  if (s.status === "in_progress") return { standing: "blocked", reason: "SAM.gov registration is still in progress." };
  if (s.expires && s.expires < today.toISOString().slice(0, 10)) return { standing: "blocked", reason: `SAM.gov registration expired on ${s.expires}.` };
  return { standing: "ok", reason: s.expires ? `SAM.gov registration active until ${s.expires}.` : "SAM.gov registration active." };
}

/** Days until the SAM registration expires; negative once past; null when no date is known. */
export function samDaysLeft(a: GovAnswers, today: Date = new Date()): number | null {
  const e = a.sam?.status === "active" ? a.sam.expires : null;
  if (!e) return null;
  const day = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((Date.parse(`${e}T00:00:00Z`) - day) / 86_400_000);
}

/**
 * SAM.gov's set-aside codes (every code in the 16 Nov 2026 extract with a
 * status a client can hold), to the status that claims them. A code not listed
 * here (ISBEE, VSA, EDWOSB and the like) is one this profile does not ask
 * about, so it always screens as "check".
 */
const SET_ASIDE_CODE: Record<string, SetAsideKey> = {
  SBA: "small_business", SBP: "small_business",
  "8A": "eight_a", "8AN": "eight_a",
  WOSB: "wosb", WOSBSS: "wosb",
  HZC: "hubzone", HZS: "hubzone",
  SDVOSBC: "sdvosb", SDVOSBS: "sdvosb",
};

/**
 * Can this client claim a notice's set-aside? `code` is rfp_notice.set_aside:
 * null when the notice has none (open to all, so ok).
 */
export function setAsideStanding(a: GovAnswers, code: string | null | undefined): { standing: Standing; reason: string } {
  const codes = (code ?? "").split(",").map(c => c.trim().toUpperCase()).filter(Boolean);
  if (!codes.length) return { standing: "ok", reason: "No set-aside." };
  const statuses = a.set_asides?.statuses ?? {};
  let unknown: string | null = null, refused: string | null = null;
  for (const c of codes) {
    const key = SET_ASIDE_CODE[c];
    if (!key) { unknown ??= `The set-aside "${c}" is not one this profile covers.`; continue; }
    const label = SET_ASIDES.find(s => s.v === key)!.l;
    const v = statuses[key];
    // A notice set aside for more than one status is open to a holder of any of them.
    if (v === "yes") return { standing: "ok", reason: `Set aside for ${label}, which this client holds.` };
    if (v === "no") refused ??= `Set aside for ${label}, which this client does not hold.`;
    else unknown ??= `Set aside for ${label}: not confirmed for this client.`;
  }
  if (unknown) return { standing: "check", reason: unknown };
  return { standing: "blocked", reason: refused! };
}

/** One line per gate, for For Granted's view of the client. */
export function gateLines(a: GovAnswers, today: Date = new Date()): { key: GateKey; label: string; state: GateState; line: string }[] {
  const label = (set: Opt[], v: string) => set.find(o => o.v === v)?.l ?? v;
  return GATES.map(g => {
    const state = gateState(a, g.key);
    let line = "Not answered yet";
    if (g.key === "sam" && a.sam) {
      const left = samDaysLeft(a, today);
      line = label(SAM_STATUS, a.sam.status)
        + (a.sam.uei ? `, UEI ${a.sam.uei}` : "") + (a.sam.cage ? `, CAGE ${a.sam.cage}` : "")
        + (a.sam.status === "active" ? (left === null ? ", expiry date not given" : left < 0 ? `, expired ${a.sam.expires}` : `, expires ${a.sam.expires}`) : "");
    } else if (g.key === "clearance" && a.clearance) line = label(CLEARANCE_LEVELS, a.clearance.level);
    else if (g.key === "cmmc" && a.cmmc) line = label(CMMC_LEVELS, a.cmmc.level);
    else if (g.key === "fedramp" && a.fedramp) line = label(FEDRAMP_POSTURES, a.fedramp.posture);
    else if (g.key === "gsa_schedule" && a.gsa_schedule) line = label(GSA_STATUS, a.gsa_schedule.status) + (a.gsa_schedule.contract ? `, contract ${a.gsa_schedule.contract}` : "");
    else if (g.key === "set_asides" && a.set_asides) {
      const st = a.set_asides.statuses;
      const yes = SET_ASIDES.filter(s => st[s.v] === "yes").map(s => s.l);
      const open = SET_ASIDES.filter(s => st[s.v] !== "yes" && st[s.v] !== "no").length;
      line = (yes.length ? `Holds: ${yes.join(", ")}` : "Holds none of those answered") + (open ? `; ${open} to confirm` : "");
    }
    return { key: g.key, label: g.label, state, line };
  });
}
