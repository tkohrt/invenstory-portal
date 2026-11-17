// Rubric v1.1's rules, case by case (patch 54).
import { describe, it, expect } from "vitest";
import {
  stageOf, detectRequirements, gateFindings, gateResultOf, liftClassOf, screenRfp, verdict,
  BUCKET_OF, type RfpNoticeInput, type FitJudgment,
} from "@/lib/rfp-rubric";
import { cleanGovInput, type GovAnswers, type GovInput } from "@/lib/gov-readiness";

const today = new Date("2026-11-17T12:00:00Z");
const n = (o: Partial<RfpNoticeInput> = {}): RfpNoticeInput => ({
  title: "Custom web platform for permit intake", agency: "Agency", notice_type: "solicitation",
  evidence_tier: "T1", jurisdiction: "federal", description: "Build and support a web platform.", ...o,
});
const answers = (i: GovInput): GovAnswers => cleanGovInput(i, {}, { by: "u", role: "client" }, today).answers;
const ready = answers({
  sam: { status: "active", expires: "2027-06-01" }, clearance: { level: "none" }, cmmc: { level: "none" },
  fedramp: { posture: "none" }, gsa_schedule: { status: "none" },
  set_asides: { statuses: { small_business: "yes", eight_a: "no", wosb: "no", hubzone: "no", sdvosb: "no" } },
});
const j = (fit: FitJudgment["fit"], o: Partial<FitJudgment> = {}): FitJudgment => ({ fit, shapeable: false, dealBreaker: null, strategic: null, ...o });

describe("stageOf", () => {
  it("reads the moment a notice is", () => {
    expect(stageOf(n({ notice_type: "award" }))).toBe("award");
    expect(stageOf(n({ notice_type: "forecast" }))).toBe("forecast");
    expect(stageOf(n({ notice_type: "sources_sought" }))).toBe("rfi");
    expect(stageOf(n({ title: "RFI: AI tooling", notice_type: "special_notice" }))).toBe("rfi");
    expect(stageOf(n({ notice_type: "presolicitation" }))).toBe("presolicitation");
    expect(stageOf(n({ notice_type: "presolicitation", description: "This is a DRAFT solicitation for industry comment." }))).toBe("draft");
    expect(stageOf(n({ notice_type: "special_notice", description: "An assessment event; submit a white paper." }))).toBe("assessment_event");
    expect(stageOf(n({ notice_type: "special_notice", description: "Industry day announcement." }))).toBe("informational");
    expect(stageOf(n({ notice_type: "combined_synopsis" }))).toBe("solicitation");
  });
  it("keeps a sources sought that carries a draft work statement as an RFI", () => {
    expect(stageOf(n({ notice_type: "sources_sought", description: "Sources sought with a draft Performance Work Statement." }))).toBe("rfi");
  });
  it("does not mistake a solicitation that mentions market research in its body for an RFI", () => {
    expect(stageOf(n({ description: "Prior market research showed two vendors." }))).toBe("solicitation");
  });
});

describe("detectRequirements", () => {
  it("finds stated gates and nothing else", () => {
    expect(detectRequirements(n())).toEqual({ clearance: null, cmmc: null, fedramp: false, gsaSchedule: false, oemOnly: false });
    expect(detectRequirements(n({ description: "DD Form 254 requires a TOP SECRET facility clearance." })).clearance).toBe("top_secret");
    expect(detectRequirements(n({ description: "Contractor must hold a Secret facility clearance (FCL)." })).clearance).toBe("secret");
    expect(detectRequirements(n({ description: "CMMC Level 1 applies." })).cmmc).toBe(1);
    expect(detectRequirements(n({ description: "CMMC L2 noted." })).cmmc).toBe(2);
    expect(detectRequirements(n({ description: "CMMC applies." })).cmmc).toBe(2);
    expect(detectRequirements(n({ description: "Hosted on FedRAMP Moderate infrastructure." })).fedramp).toBe(true);
    expect(detectRequirements(n({ description: "Open to GSA MAS holders under SIN 54151S." })).gsaSchedule).toBe(true);
    expect(detectRequirements(n({ description: "Only OEMs may respond." })).oemOnly).toBe(true);
  });
  it("does not read a personnel clearance question as a facility clearance", () => {
    expect(detectRequirements(n({ description: "Describe your ability to obtain clearances for future work." })).clearance).toBeNull();
  });
});

describe("gates: unknown is check, never fail", () => {
  it("SAM applies to federal notices only", () => {
    expect(gateFindings(n(), detectRequirements(n()), {}, today).map(f => f.gate)).toEqual(["sam"]);
    expect(gateFindings(n({ jurisdiction: "state_local" }), detectRequirements(n()), {}, today)).toEqual([]);
  });
  it("closes on a gate the client lacks, checks on one it has not confirmed, opens on one it holds", () => {
    const req = detectRequirements(n({ description: "Requires a Secret facility clearance." }));
    expect(gateResultOf(gateFindings(n(), req, ready, today))).toBe("closed");
    expect(gateResultOf(gateFindings(n(), req, answers({ sam: { status: "active" } }), today))).toBe("check");
    expect(gateResultOf(gateFindings(n(), req, answers({ sam: { status: "active" }, clearance: { level: "top_secret" } }), today))).toBe("open");
  });
  it("an empty profile never closes a gate", () => {
    const req = detectRequirements(n({ description: "TOP SECRET facility clearance; CMMC Level 2; GSA Schedule holders only." }));
    const f = gateFindings(n({ set_aside: "8A" }), req, {}, today);
    expect(f.every(x => x.standing === "check")).toBe(true);
    expect(gateResultOf(f)).toBe("check");
  });
  it("FedRAMP never closes; a teaming-only Schedule closes as prime", () => {
    const fr = detectRequirements(n({ description: "FedRAMP authorized hosting required." }));
    expect(gateResultOf(gateFindings(n(), fr, ready, today))).toBe("check");
    const gsa = detectRequirements(n({ description: "Limited to GSA Schedule holders." }));
    const teaming = answers({ sam: { status: "active" }, gsa_schedule: { status: "teaming" } });
    expect(gateResultOf(gateFindings(n(), gsa, teaming, today))).toBe("closed");
  });
  it("an expired SAM registration closes a federal notice", () => {
    const expired = answers({ sam: { status: "active", expires: "2026-10-01" } });
    expect(gateResultOf(gateFindings(n(), detectRequirements(n()), expired, today))).toBe("closed");
  });
});

describe("liftClassOf", () => {
  it("sets lift by what the notice demands", () => {
    expect(liftClassOf(n(), "rfi")).toBe("rfi");
    expect(liftClassOf(n(), "assessment_event")).toBe("assessment_event");
    expect(liftClassOf(n(), "solicitation")).toBe("federal_rfp");
    expect(liftClassOf(n({ jurisdiction: "state_local" }), "solicitation")).toBe("state_rfp");
    expect(liftClassOf(n({ description: "A multiple-award IDIQ." }), "solicitation")).toBe("major_vehicle");
    expect(liftClassOf(n(), "forecast")).toBeNull();
  });
});

describe("screenRfp, in the rubric's order", () => {
  it("1. an award is tracked for recompete even from a tracker row", () => {
    expect(screenRfp(n({ notice_type: "award", evidence_tier: "T2" }), ready, today).action).toBe("track_recompete");
  });
  it("2. aggregator text is never scored", () => {
    const s = screenRfp(n({ evidence_tier: "T2" }), ready, today);
    expect(s.action).toBe("cannot_score");
    expect(s.notes[0]).toMatch(/issuing agency/);
  });
  it("3. a closed gate skips as prime; a draft with an openable gate is watched with a plan", () => {
    expect(screenRfp(n({ description: "TOP SECRET facility clearance required." }), ready, today).action).toBe("skip_team");
    const draft = screenRfp(n({ notice_type: "presolicitation", description: "DRAFT solicitation. Limited to GSA Schedule holders." }), ready, today);
    expect(draft.action).toBe("watch_gate_plan");
    const notOpenable = screenRfp(n({ notice_type: "presolicitation", description: "DRAFT solicitation. TOP SECRET facility clearance." }), ready, today);
    expect(notOpenable.action).toBe("skip_team");
  });
  it("3. an RFI's award-time gates are noted, never closing", () => {
    const s = screenRfp(n({ notice_type: "sources_sought", description: "Respondents will later need a Secret facility clearance." }), ready, today);
    expect(s.action).toBeNull();
    expect(s.gateResult).toBe("check");
    expect(s.notes[0]).toMatch(/^At award, not now/);
  });
  it("4. forecasts, drafts and informational notices are watched", () => {
    expect(screenRfp(n({ notice_type: "forecast" }), ready, today).action).toBe("watch");
    expect(screenRfp(n({ notice_type: "presolicitation" }), ready, today).action).toBe("watch");
    expect(screenRfp(n({ notice_type: "special_notice", description: "For information only." }), ready, today).action).toBe("watch");
  });
  it("5. otherwise fit is needed", () => {
    expect(screenRfp(n(), ready, today).action).toBeNull();
  });
});

describe("verdict, mechanically", () => {
  const sol = screenRfp(n(), ready, today);
  const rfi = screenRfp(n({ notice_type: "sources_sought" }), ready, today);
  const vehicle = screenRfp(n({ description: "A multiple-award IDIQ." }), ready, today);
  it("solicitations: High bids, Medium leans, Low passes", () => {
    expect(verdict(sol, j("High")).action).toBe("bid");
    expect(verdict(sol, j("Medium")).action).toBe("lean_bid");
    expect(verdict(sol, j("Low")).action).toBe("pass");
    expect(verdict(sol, j("Low")).notes.at(-1)).toMatch(/category watch/);
  });
  it("a major vehicle at High fit is a lean bid, as a team; a deal-breaker caps at lean bid", () => {
    expect(verdict(vehicle, j("High")).action).toBe("lean_bid");
    expect(verdict(sol, j("High", { dealBreaker: "a bonding requirement" })).action).toBe("lean_bid");
  });
  it("RFIs: answer at Medium or above, or with strategic value, or when shapeable; else pass", () => {
    expect(verdict(rfi, j("Medium")).action).toBe("answer");
    expect(verdict(rfi, j("Low", { strategic: "warm agency relationship" })).action).toBe("answer");
    expect(verdict(rfi, j("Low", { shapeable: true })).action).toBe("answer");
    expect(verdict(rfi, j("Low")).action).toBe("pass");
  });
  it("an RFI with a deal-breaker is answered in a reframed capacity, and says so", () => {
    const v = verdict(rfi, j("Medium", { dealBreaker: "three government case studies" }));
    expect(v.action).toBe("answer");
    expect(v.notes[0]).toMatch(/reframed capacity: three government case studies/);
  });
  it("a rule-decided screen ignores the fit", () => {
    const skip = screenRfp(n({ description: "TOP SECRET facility clearance." }), ready, today);
    expect(verdict(skip, j("High")).action).toBe("skip_team");
  });
  it("every action has a bucket", () => {
    expect(Object.keys(BUCKET_OF)).toHaveLength(9);
  });
});
