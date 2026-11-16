// Government readiness, the RFP Engine's gate profile (patch 53).
import { describe, it, expect } from "vitest";
import {
  cleanGovInput, parseGovAnswers, toGovInput, gateState, gatesAnswered, samStanding, samDaysLeft,
  setAsideStanding, gateLines, GATES, RFP_ENGINE_KEY, type GovAnswers, type GovInput,
} from "@/lib/gov-readiness";

const client = { by: "u-client", role: "client" as const };
const admin = { by: "u-admin", role: "admin" as const };
const t0 = new Date("2026-11-16T15:00:00Z");
const t1 = new Date("2026-11-20T15:00:00Z");
const full: GovInput = {
  sam: { status: "active", uei: "abc123def456", cage: "1a2b3", expires: "2027-03-01" },
  clearance: { level: "none" }, cmmc: { level: "level_1" }, fedramp: { posture: "not_applicable" },
  gsa_schedule: { status: "held", contract: "47QTCA20D0001" },
  set_asides: { statuses: { small_business: "yes", eight_a: "no", wosb: "no", hubzone: "no", sdvosb: "no" } },
};
const saved = (input: GovInput, who = client, at = t0, prior: GovAnswers = {}) => cleanGovInput(input, prior, who, at).answers;

describe("the switch", () => {
  it("is a feature_visibility key of its own", () => { expect(RFP_ENGINE_KEY).toBe("rfp_engine"); });
  it("has six gates", () => { expect(GATES.map(g => g.key)).toEqual(["sam", "clearance", "cmmc", "fedramp", "gsa_schedule", "set_asides"]); });
});

describe("cleanGovInput", () => {
  it("stores valid answers, tidied, each stamped with who and when", () => {
    const r = cleanGovInput(full, {}, client, t0);
    expect(r.problems).toEqual([]);
    expect(r.changed).toHaveLength(6);
    expect(r.answers.sam).toEqual({ status: "active", uei: "ABC123DEF456", cage: "1A2B3", expires: "2027-03-01", by: "u-client", role: "client", at: t0.toISOString() });
    expect(r.answers.gsa_schedule).toMatchObject({ status: "held", contract: "47QTCA20D0001" });
    expect(gatesAnswered(r.answers)).toBe(6);
  });

  it("a gate left blank is unanswered, and unknown values are dropped", () => {
    const r = cleanGovInput({ sam: { status: "definitely" }, clearance: { level: "" }, cmmc: { level: "level_9" }, fedramp: { posture: "ready" } } as GovInput, {}, client, t0);
    expect(Object.keys(r.answers)).toEqual(["fedramp"]);
  });

  it("refuses a malformed UEI, CAGE or date with a sentence, and keeps the rest", () => {
    const r = cleanGovInput({ sam: { status: "active", uei: "123", cage: "TOOLONG", expires: "2027-02-31" } }, {}, client, t0);
    expect(r.answers.sam).toMatchObject({ status: "active", uei: null, cage: null, expires: null });
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toMatch(/UEI is 12 letters and numbers/);
  });

  it("identifiers only belong to an active registration; a contract number only to a held Schedule", () => {
    const a = saved({ sam: { status: "in_progress", uei: "ABC123DEF456", expires: "2027-03-01" }, gsa_schedule: { status: "applied", contract: "X" } });
    expect(a.sam).toMatchObject({ status: "in_progress", uei: null, cage: null, expires: null });
    expect(a.gsa_schedule).toMatchObject({ status: "applied", contract: null });
  });

  it("an unchanged gate keeps its stamp; a changed one is stamped by whoever saved", () => {
    const first = saved(full, client, t0);
    const r = cleanGovInput({ ...full, cmmc: { level: "level_2" } }, first, admin, t1);
    expect(r.changed).toEqual(["cmmc"]);
    expect(r.answers.sam).toEqual(first.sam);
    expect(r.answers.cmmc).toEqual({ level: "level_2", by: "u-admin", role: "admin", at: t1.toISOString() });
  });

  it("clearing a gate is a change, and saving the same answers again is not", () => {
    const first = saved(full);
    const { clearance: _gone, ...rest } = full; void _gone;
    const r = cleanGovInput(rest, first, client, t1);
    expect(r.changed).toEqual(["clearance"]);
    expect(r.answers.clearance).toBeUndefined();
    expect(cleanGovInput(toGovInput(first), first, admin, t1).changed).toEqual([]);
  });

  it("survives junk from anyone posting to the action", () => {
    for (const junk of [null, 7, "x", [], { sam: "active" }, { set_asides: { statuses: { small_business: "maybe", made_up: "yes" } } }]) {
      expect(cleanGovInput(junk as unknown as GovInput, {}, client, t0).answers).toEqual({});
    }
  });
});

describe("parseGovAnswers", () => {
  it("round-trips what was saved and drops anything unstamped or out of shape", () => {
    const a = saved(full);
    expect(parseGovAnswers(JSON.parse(JSON.stringify(a)))).toEqual(a);
    expect(parseGovAnswers({ sam: { status: "active" }, cmmc: { level: "nonsense", by: "u", role: "client", at: "x" } })).toEqual({});
    expect(parseGovAnswers(null)).toEqual({});
    expect(parseGovAnswers("{}")).toEqual({});
  });
});

describe("gateState: to be confirmed and unanswered are both open", () => {
  it("reads each gate", () => {
    const a = saved({ sam: { status: "tbc" }, clearance: { level: "secret" }, set_asides: { statuses: { small_business: "yes", eight_a: "tbc" } } });
    expect(gateState(a, "sam")).toBe("tbc");
    expect(gateState(a, "clearance")).toBe("answered");
    expect(gateState(a, "cmmc")).toBe("unanswered");
    // Set-asides settle only when all five are yes or no.
    expect(gateState(a, "set_asides")).toBe("tbc");
    expect(gateState(saved({ set_asides: { statuses: { small_business: "yes" } } }), "set_asides")).toBe("tbc");
    expect(gateState(saved(full), "set_asides")).toBe("answered");
    expect(gatesAnswered(a)).toBe(1);
    expect(gatesAnswered({})).toBe(0);
  });
});

describe("samStanding: unknown is check, never fail", () => {
  const today = new Date("2026-11-16T12:00:00Z");
  it("checks when unanswered or to be confirmed", () => {
    expect(samStanding({}, today).standing).toBe("check");
    expect(samStanding(saved({ sam: { status: "tbc" } }), today).standing).toBe("check");
  });
  it("blocks when not registered, still registering, or expired", () => {
    expect(samStanding(saved({ sam: { status: "none" } }), today).standing).toBe("blocked");
    expect(samStanding(saved({ sam: { status: "in_progress" } }), today).standing).toBe("blocked");
    const expired = samStanding(saved({ sam: { status: "active", expires: "2026-11-15" } }), today);
    expect(expired).toEqual({ standing: "blocked", reason: "SAM.gov registration expired on 2026-11-15." });
  });
  it("is ok when active: on its last day, and with no date given", () => {
    expect(samStanding(saved({ sam: { status: "active", expires: "2026-11-16" } }), today).standing).toBe("ok");
    expect(samStanding(saved({ sam: { status: "active" } }), today).standing).toBe("ok");
  });
  it("counts the days left", () => {
    expect(samDaysLeft(saved({ sam: { status: "active", expires: "2026-12-16" } }), today)).toBe(30);
    expect(samDaysLeft(saved({ sam: { status: "active", expires: "2026-11-15" } }), today)).toBe(-1);
    expect(samDaysLeft(saved({ sam: { status: "active" } }), today)).toBeNull();
    expect(samDaysLeft({}, today)).toBeNull();
  });
});

describe("setAsideStanding, against SAM.gov's own codes", () => {
  const a = saved({ set_asides: { statuses: { small_business: "yes", eight_a: "no", hubzone: "tbc" } } });
  it("no set-aside is open to all", () => {
    expect(setAsideStanding({}, null).standing).toBe("ok");
    expect(setAsideStanding(a, "").standing).toBe("ok");
  });
  it("a status the client holds is ok, one it lacks is blocked, with the reason named", () => {
    expect(setAsideStanding(a, "SBA").standing).toBe("ok");
    expect(setAsideStanding(a, "SBP").standing).toBe("ok");
    expect(setAsideStanding(a, "8A")).toEqual({ standing: "blocked", reason: "Set aside for 8(a), which this client does not hold." });
    expect(setAsideStanding(a, "8AN").standing).toBe("blocked");
  });
  it("anything not confirmed is check: to be confirmed, unanswered, no answers at all, or a code the profile does not cover", () => {
    expect(setAsideStanding(a, "HZC").standing).toBe("check");
    expect(setAsideStanding(a, "SDVOSBC").standing).toBe("check");
    expect(setAsideStanding({}, "SBA").standing).toBe("check");
    expect(setAsideStanding(a, "ISBEE").standing).toBe("check");
    expect(setAsideStanding(a, "EDWOSB").standing).toBe("check");
  });
  it("several codes: holding any one is ok; lacking one and unsure of another is check", () => {
    expect(setAsideStanding(a, "8A,SBA").standing).toBe("ok");
    expect(setAsideStanding(a, "8A,HZC").standing).toBe("check");
    expect(setAsideStanding(saved({ set_asides: { statuses: { eight_a: "no", hubzone: "no" } } }), "8a, hzc").standing).toBe("blocked");
  });
});

describe("gateLines, For Granted's view", () => {
  it("says where each gate stands in words", () => {
    const lines = gateLines(saved({ ...full, clearance: { level: "tbc" } }), new Date("2026-11-16T12:00:00Z"));
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatchObject({ key: "sam", state: "answered", line: "Registered and active, UEI ABC123DEF456, CAGE 1A2B3, expires 2027-03-01" });
    expect(lines[1]).toMatchObject({ key: "clearance", state: "tbc", line: "To be confirmed" });
    expect(lines[5]!.line).toBe("Holds: Small business");
    expect(gateLines({}).every(l => l.state === "unanswered" && l.line === "Not answered yet")).toBe(true);
  });
});
