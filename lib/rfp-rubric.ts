// Rubric v1.1, encoded: the RFP Engine's rules (patch 54, 17 Nov 2026).
//
// Source: the Big Kitty Labs re-run of 12 November 2026 (Rubric v1, blind-
// tested at 87.5% action agreement against an 80% bar) plus the eight
// amendments adopted from it as v1.1. Plan: project doc "RFP Engine, Portal
// Integration and Build Plan (16 November 2026)", section 4.
//
// Everything here is rules, not vibes, and pure (tests/portal/rfp-rubric.test.ts
// and the golden set, lib/rfp-golden.ts). The one judgment, fit, is the model's
// (lib/server/rfp-fit.ts); this module decides everything around it, in the
// rubric's codified order (amendment 3):
//
//   1. terminal status   an award is tracked for recompete, verified or not
//   2. evidence          T2/T3 alone is never scored: "cannot score"
//   3. gates             a closed gate ends it: skip as prime, teaming only;
//                        draft-stage with an openable gate: watch, with a plan
//   4. stage             forecast, draft, presolicitation: watch
//   5. fit               the model; then the mechanical verdict
//
// An unanswered or to-be-confirmed gate is "check", never "fail" (the BKL
// lesson): it never closes a gate.
import {
  samStanding, setAsideStanding, TBC,
  type GovAnswers, type Standing,
} from "./gov-readiness";

export const RUBRIC_VERSION = "1.1";
/** No rubric or prompt change ships unless the golden set holds this. */
export const GOLDEN_BAR = 0.8;

// ------------------------------------------------------------------ inputs

export type Tier = "T1" | "T2" | "T3";
export type Jurisdiction = "federal" | "state_local";
export type Fit = "High" | "Medium" | "Low";

/** A notice as the rubric reads it: rfp_notice's fields, plus where it came from. */
export interface RfpNoticeInput {
  title: string;
  agency?: string | null;
  notice_type: string;          // rfp_notice.notice_type (normalized)
  notice_type_raw?: string | null;
  set_aside?: string | null;    // rfp_notice.set_aside (SAM codes)
  description?: string | null;
  due_at?: string | null;
  evidence_tier: Tier;
  jurisdiction: Jurisdiction;
}

// ------------------------------------------------------------------- stage

export type Stage =
  | "award" | "forecast" | "draft" | "presolicitation"
  | "rfi" | "assessment_event" | "informational" | "solicitation" | "grant";

const RX = {
  rfi: /\b(request for information|RFI|sources sought|market research)\b/i,
  draft: /\bdraft (solicitation|RFP|RFQ|performance work statement|PWS|statement of work|SOW)\b/i,
  event: /\b(assessment event|white paper|commercial solutions opening|\bCSO\b|broad agency announcement|\bBAA\b)\b/i,
  informational: /\b(informational (purposes )?only|for information only|no (proposals|quotes|responses) (are |will be )?(requested|accepted))\b/i,
  majorVehicle: /\b(IDIQ|indefinite[- ]delivery|blanket purchase agreements?|\bBPAs?\b|GWAC|multiple[- ]award)\b/i,
  rfq: /\b(RFQ|request for (quotes?|quotations?|qualifications))\b/i,
};

const text = (n: RfpNoticeInput) => `${n.title}\n${n.notice_type_raw ?? ""}\n${n.description ?? ""}`;

/** What kind of moment this notice is. Order matters: an award is terminal before anything else. */
export function stageOf(n: RfpNoticeInput): Stage {
  const t = text(n);
  if (n.notice_type === "award") return "award";
  if (n.notice_type === "forecast") return "forecast";
  if (n.notice_type === "grant") return "grant";
  // A live response window comes before "draft": a sources sought that ships a
  // draft work statement (common on SAM.gov) is still an RFI to answer now.
  if (n.notice_type === "sources_sought" || RX.rfi.test(n.title) || RX.rfi.test(n.notice_type_raw ?? "")) return "rfi";
  if (RX.draft.test(t)) return "draft";
  if (n.notice_type === "presolicitation") return "presolicitation";
  if (RX.event.test(t)) return "assessment_event";
  if (n.notice_type === "special_notice") return RX.informational.test(t) || !RX.rfi.test(t) ? "informational" : "rfi";
  return "solicitation";
}

// ------------------------------------------------------------- requirements

export type ClearanceLevel = "confidential" | "secret" | "top_secret" | "unspecified";
export interface Requirements {
  clearance: ClearanceLevel | null;
  cmmc: 1 | 2 | 3 | null;
  fedramp: boolean;
  gsaSchedule: boolean;
  oemOnly: boolean;
}

/**
 * Gate requirements the notice states, read from its own text. Conservative:
 * a requirement is found only when the text says so in recognisable words.
 * (A notice that hides a clearance in an attachment the index does not hold is
 * caught by the human gate before anything client-committal: the plan's step 6.)
 */
export function detectRequirements(n: RfpNoticeInput): Requirements {
  const t = text(n);
  let clearance: ClearanceLevel | null = null;
  if (/\b(facility (security )?clearance|\bFCL\b|DD[- ]?(Form )?254)\b/i.test(t) || /\b(TS\/SCI|top secret)\b/i.test(t)) {
    clearance = /\b(TS\/SCI|top secret)\b/i.test(t) ? "top_secret"
      : /\bsecret\b/i.test(t) ? "secret"
      : /\bconfidential\b/i.test(t) ? "confidential" : "unspecified";
  }
  const cm = /\bCMMC\b(?:[^.\n]{0,20}?\b(?:L(?:evel)?\s*)([123]))?/i.exec(t);
  const cmmc = cm ? (Number(cm[1] ?? 2) as 1 | 2 | 3) : null;
  return {
    clearance,
    cmmc,
    fedramp: /\bFedRAMP\b/i.test(t),
    gsaSchedule: /\b(GSA (MAS|schedule)|multiple award schedule|schedule holders|MAS holders|under GSA|GSA eBuy|\bSIN \d{6}[A-Z]?\b)/i.test(t),
    oemOnly: /\b(only OEMs|OEM[- ]only|only original equipment manufacturers)\b/i.test(t),
  };
}

// -------------------------------------------------------------------- gates

export type GateKind = "sam" | "clearance" | "cmmc" | "fedramp" | "gsa_schedule" | "set_aside" | "oem_only";
export interface GateFinding { gate: GateKind; standing: Standing; reason: string; openable: boolean }
export type GateResult = "open" | "closed" | "check";

/** Gates a client can open before a real solicitation lands (amendment 3). */
const OPENABLE: ReadonlySet<GateKind> = new Set(["sam", "gsa_schedule", "cmmc"]);
const CLEARANCE_RANK: Record<string, number> = { none: 0, confidential: 1, secret: 2, top_secret: 3 };
const CMMC_RANK: Record<string, number> = { none: 0, level_1: 1, level_2: 2, level_3: 3 };

function finding(gate: GateKind, standing: Standing, reason: string): GateFinding {
  return { gate, standing, reason, openable: OPENABLE.has(gate) };
}

/** Each gate the notice raises, judged against the client's answers. */
export function gateFindings(n: RfpNoticeInput, req: Requirements, a: GovAnswers, today: Date): GateFinding[] {
  const out: GateFinding[] = [];
  if (n.jurisdiction === "federal") {
    const s = samStanding(a, today);
    out.push(finding("sam", s.standing, s.reason));
  }
  if (req.clearance) {
    const lvl = a.clearance?.level;
    const need = req.clearance === "unspecified" ? 1 : CLEARANCE_RANK[req.clearance]!;
    const label = req.clearance === "unspecified" ? "a facility clearance" : `a ${req.clearance.replace("_", " ")} facility clearance`;
    if (!lvl || lvl === TBC) out.push(finding("clearance", "check", `Requires ${label}; the client's clearance is not confirmed.`));
    else if ((CLEARANCE_RANK[lvl] ?? 0) >= need) out.push(finding("clearance", "ok", `Requires ${label}, which the client holds.`));
    else out.push(finding("clearance", "blocked", `Requires ${label}; the client has none at that level.`));
  }
  if (req.cmmc) {
    const lvl = a.cmmc?.level;
    if (!lvl || lvl === TBC) out.push(finding("cmmc", "check", `Requires CMMC Level ${req.cmmc}; the client's level is not confirmed.`));
    else if ((CMMC_RANK[lvl] ?? 0) >= req.cmmc) out.push(finding("cmmc", "ok", `Requires CMMC Level ${req.cmmc}, which the client holds.`));
    else out.push(finding("cmmc", "blocked", `Requires CMMC Level ${req.cmmc}; the client is not certified at that level.`));
  }
  if (req.fedramp) {
    // Never closes: an authorized cloud can be built on (the BKL profile's
    // "satisfiable by architecture choice"). Ok only when the client says so.
    const p = a.fedramp?.posture;
    out.push(p === "authorized" || p === "ready"
      ? finding("fedramp", "ok", "Mentions FedRAMP; the client's posture covers it.")
      : finding("fedramp", "check", "Mentions FedRAMP; check whether building on an authorized cloud satisfies it."));
  }
  if (req.gsaSchedule) {
    const g = a.gsa_schedule?.status;
    if (g === "held") out.push(finding("gsa_schedule", "ok", "Limited to GSA Schedule holders; the client holds one."));
    else if (g === "none") out.push(finding("gsa_schedule", "blocked", "Limited to GSA Schedule holders; the client holds none."));
    else if (g === "teaming") out.push(finding("gsa_schedule", "blocked", "Limited to GSA Schedule holders; the client can take part only through its Schedule-holding teaming partner."));
    else out.push(finding("gsa_schedule", "check", g === "applied"
      ? "Limited to GSA Schedule holders; the client's Schedule application is pending."
      : "Limited to GSA Schedule holders; the client's Schedule status is not confirmed."));
  }
  if (n.set_aside) {
    const s = setAsideStanding(a, n.set_aside);
    out.push(finding("set_aside", s.standing, s.reason));
  }
  if (req.oemOnly) out.push(finding("oem_only", "blocked", "Open only to original equipment manufacturers."));
  return out;
}

export function gateResultOf(f: GateFinding[]): GateResult {
  if (f.some(x => x.standing === "blocked")) return "closed";
  if (f.some(x => x.standing === "check")) return "check";
  return "open";
}

// --------------------------------------------------------------------- lift

export type LiftClass = "rfi" | "assessment_event" | "state_rfp" | "federal_rfp" | "major_vehicle";
export const LIFT: Record<LiftClass, { label: string; hours: string }> = {
  rfi: { label: "RFI or sources sought", hours: "4-12 hours" },
  assessment_event: { label: "Assessment event or white paper", hours: "20-60 hours" },
  state_rfp: { label: "State or local RFP or RFQ", hours: "30-100 hours (an RFQ sits at the low end)" },
  federal_rfp: { label: "Federal RFP", hours: "150-400 hours" },
  major_vehicle: { label: "Major vehicle (IDIQ, BPA or GWAC)", hours: "400+ hours, as a team" },
};

/** Lift by what this notice demands, never by its dollar value. Null when there is nothing to respond to. */
export function liftClassOf(n: RfpNoticeInput, stage: Stage): LiftClass | null {
  if (stage === "rfi") return "rfi";
  if (stage === "assessment_event") return "assessment_event";
  if (stage !== "solicitation") return null;
  if (RX.majorVehicle.test(text(n))) return "major_vehicle";
  return n.jurisdiction === "federal" ? "federal_rfp" : "state_rfp";
}

// ------------------------------------------------------------------ verdict

export type Action =
  | "bid" | "lean_bid" | "answer" | "pass" | "skip_team"
  | "watch" | "watch_gate_plan" | "track_recompete" | "cannot_score";
export type Bucket = "draft_submit" | "open_response" | "no_source" | "spend_nothing" | "upcoming";

/** The five buckets clients saw on slide 5 of the BKL retrospective. */
export const BUCKET_OF: Record<Action, Bucket> = {
  bid: "draft_submit", lean_bid: "draft_submit",
  answer: "open_response",
  cannot_score: "no_source",
  pass: "spend_nothing", skip_team: "spend_nothing", track_recompete: "spend_nothing",
  watch: "upcoming", watch_gate_plan: "upcoming",
};
export const BUCKET_LABEL: Record<Bucket, string> = {
  draft_submit: "Draft and submit",
  open_response: "Open response windows",
  no_source: "No source, no score",
  spend_nothing: "Spend nothing here",
  upcoming: "Upcoming RFP windows",
};
export const ACTION_LABEL: Record<Action, string> = {
  bid: "Bid",
  lean_bid: "Lean bid or pass; decide at the Q&A stage",
  answer: "Answer",
  pass: "Pass",
  skip_team: "Skip as prime; teaming only",
  watch: "Watch list",
  watch_gate_plan: "Watch, with a gate-opening plan",
  track_recompete: "Track for recompete",
  cannot_score: "Cannot score: verification required",
};

/** The rule-side screen: everything decidable before any model call. */
export interface Screen {
  stage: Stage;
  requirements: Requirements;
  findings: GateFinding[];
  gateResult: GateResult;
  liftClass: LiftClass | null;
  /** Decided without the model, or null when fit is needed. */
  action: Action | null;
  /** Fit may still be scored, marked provisional, for prioritising (amendment 8). */
  provisionalFitAllowed: boolean;
  notes: string[];
}

/**
 * Steps 1 to 4. When `action` comes back null, the notice needs a fit judgment
 * and then `verdict()`. Grants are not this engine's: callers keep them out.
 */
export function screenRfp(n: RfpNoticeInput, a: GovAnswers, today: Date = new Date()): Screen {
  const stage = stageOf(n);
  const requirements = detectRequirements(n);
  const notes: string[] = [];
  const base = { stage, requirements, liftClass: liftClassOf(n, stage), provisionalFitAllowed: false, notes };

  // 1. Terminal status: nothing to pursue, so no verification needed.
  if (stage === "award") return { ...base, findings: [], gateResult: "open", action: "track_recompete" };

  // 2. Evidence: aggregator text is a lead, never a scored fact.
  if (n.evidence_tier !== "T1") {
    notes.push("Known only from an aggregator or tracker: pull the issuing agency's own notice before anything is scored.");
    return { ...base, findings: [], gateResult: "check", action: "cannot_score" };
  }

  // 3. Gates. An RFI or sources sought is market research: award-time gates
  // (a clearance for "potential future work") are noted, never closing.
  let findings = gateFindings(n, requirements, a, today);
  if (stage === "rfi") {
    for (const f of findings) if (f.standing === "blocked") notes.push(`At award, not now: ${f.reason}`);
    findings = findings.map(f => f.standing === "blocked" ? { ...f, standing: "check" as Standing } : f);
  }
  const gateResult = gateResultOf(findings);
  const early = stage === "draft" || stage === "forecast" || stage === "presolicitation";
  if (gateResult === "closed") {
    const blockers = findings.filter(f => f.standing === "blocked");
    if (early && blockers.every(b => b.openable)) {
      notes.push(`The gate can be opened before the solicitation lands: ${blockers.map(b => b.reason).join(" ")}`);
      return { ...base, findings, gateResult, action: "watch_gate_plan", provisionalFitAllowed: true };
    }
    return { ...base, findings, gateResult, action: "skip_team" };
  }

  // 4. Stage: nothing to respond to yet.
  if (early) return { ...base, findings, gateResult, action: "watch", provisionalFitAllowed: true };
  if (stage === "informational") {
    notes.push("Informational notice: nothing to respond to.");
    return { ...base, findings, gateResult, action: "watch" };
  }
  return { ...base, findings, gateResult, action: null };
}

/** What the model returns for one notice (lib/server/rfp-fit.ts). */
export interface FitJudgment {
  fit: Fit;
  /** RFI only: could a response shape the requirement toward what the client builds? */
  shapeable: boolean;
  /** A mandatory element the client cannot meet (amendment 4), or null. */
  dealBreaker: string | null;
  /** A named strategic value (relationship, funded program, recurrence), or null. */
  strategic: string | null;
}

/** Step 5: the mechanical verdict, once fit is known. */
export function verdict(s: Screen, j: FitJudgment): { action: Action; notes: string[] } {
  if (s.action) return { action: s.action, notes: s.notes };
  const notes = [...s.notes];
  if (s.stage === "rfi") {
    // Amendment 2: answer at Medium or above, or with a named strategic value;
    // at Low, only when the requirement is still shapeable.
    if (j.dealBreaker) notes.push(`Answer in a reframed capacity: ${j.dealBreaker}`);
    if (j.fit !== "Low" || j.strategic || j.shapeable) return { action: "answer", notes };
    notes.push("Low fit with no shapeable requirement: no response value.");
    return { action: "pass", notes };
  }
  // Solicitation or assessment event.
  if (j.fit === "Low") {
    notes.push("Low fit with open gates: pass; log a category watch if the category recurs.");
    return { action: "pass", notes };
  }
  if (j.dealBreaker) {
    notes.push(`A mandatory element the client cannot meet: ${j.dealBreaker}`);
    return { action: "lean_bid", notes };
  }
  if (j.fit === "High") {
    if (s.liftClass === "major_vehicle") {
      notes.push("High fit, but a major vehicle is fundable only as a team.");
      return { action: "lean_bid", notes };
    }
    return { action: "bid", notes };
  }
  return { action: "lean_bid", notes };
}
