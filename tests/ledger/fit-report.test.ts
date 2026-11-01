/**
 * The fit report (patch 6 of the 1 Nov 2026 build): every lead, the same four
 * answers, grouped by what to do, with no cap.
 */
import { describe, expect, test } from "vitest";
import {
  buildFitReport, opportunityRow, funderRow, leadRow, rangeFit, rangeTop, signalCount, reportCsv,
  type MatchInput, type LeadInput,
} from "@/lib/fit-report";
import { EMPTY_PROFILE, type EligibilityProfile } from "@/lib/eligibility-fields";
import type { FunderRow } from "@/lib/funder-rows";

const TODAY = new Date("2026-11-01T12:00:00Z");
const p: EligibilityProfile = { ...EMPTY_PROFILE, org_type: "for_profit", tax_status: "none", country_code: "KE", budget_band: "100k_500k", cause_areas: ["technical assistance"] };

const match = (o: Partial<MatchInput>): MatchInput => ({
  grant_id: "g1", verdict: "likely", reason: "names Kenya", close_date: "2026-12-15", award_ceiling: 50_000,
  title: "TA call", funder: "GIZ", url: "https://x.org", rationale: null, rationale_source: "pending", verified_at: null, ...o,
});
const funder = (o: Partial<FunderRow>): FunderRow => ({
  funder_id: "f1", ein: null, name: "Fund", website: "https://f.org", location: null, focus: null, mission: null,
  typical_grant_range: "$10,000 - $50,000", match_reason: "Funds enterprise support", confidence: "moderate", caveat: null,
  evidence: [], evidence_count: 0, from_graph: false, from_overlay: false, access_mode: "open", access_note: null,
  access_verified: true, has_grant_history: true, verified_at: null, ...o,
});
const lead = (o: Partial<LeadInput>): LeadInput => ({
  id: "l1", kind: "opportunity", money_kind: "programs", title: "Accelerator", funder: "Hub", url: "https://hub.org/apply",
  deadline: "2026-11-20", rolling: false, amount_text: "Up to $25,000", why: "They back East African firms.", eligibility: null, ...o,
});

describe("the four answers", () => {
  test("an open call that looks eligible goes to Apply with a decide-by date", () => {
    const r = opportunityRow(match({ verdict: "eligible", reason: "eligibility text names your organization type; names Kenya" }), p, TODAY);
    expect(r.group).toBe("apply");
    expect(r.eligibility.call).toBe("yes");
    expect(r.mission.call).toBe("strong");
    expect(r.range.call).toBe("fits");
    expect(r.next).toContain("decide by Nov 24, 2026");
  });
  test("a federal blocker is named, and the row goes to Research first", () => {
    const r = opportunityRow(match({ verdict: "check", reason: "federal opportunity and SAM.gov/UEI is not marked active" }), p, TODAY);
    expect(r.group).toBe("research");
    expect(r.eligibility.why).toContain("federal opportunity");
  });
  test("a deadline three weeks away says to decide this week", () => {
    expect(opportunityRow(match({ close_date: "2026-11-15" }), p, TODAY).next).toContain("decide this week");
  });
  test("the written explanation is used for mission fit when there is one", () => {
    expect(opportunityRow(match({ rationale: "Fits their incubator work.", rationale_source: "llm" }), p, TODAY).mission.why).toBe("Fits their incubator work.");
  });
  test("an open funder goes to Approach, an unknown one to Research, a closed one is ruled out", () => {
    expect(funderRow(funder({}), p).group).toBe("approach");
    expect(funderRow(funder({ access_mode: "unknown" }), p).group).toBe("research");
    expect(funderRow(funder({ access_mode: "closed" }), p).group).toBe("ruled_out");
    expect(funderRow(funder({ access_mode: "invitation_only" }), p).next).toContain("warm introduction");
  });
  test("a funder whose own rules exclude the client says No", () => {
    const r = funderRow(funder({ access_note: "We fund 501(c)(3) organizations only." }), p);
    expect(r.eligibility.call).toBe("no");
    expect(r.group).toBe("ruled_out");
  });
  test("peer grantees make a strong fit", () => {
    const r = funderRow(funder({ from_graph: true, evidence: [{ name: "Peer A" }, { name: "Peer B" }], evidence_count: 5 }), p);
    expect(r.mission).toEqual({ call: "strong", why: "Already funds organizations like yours: Peer A, Peer B and 3 more." });
  });
  test("a web find is always Research first, and says it is unchecked until approved", () => {
    const r = leadRow(lead({}), p, TODAY);
    expect(r.group).toBe("research");
    expect(r.next).toContain("not yet checked");
    expect(leadRow(lead({ review: "approved" }), p, TODAY).next).toContain("Checked by For Granted");
    expect(r.range.why).toContain("Up to $25,000");
  });
});

describe("size of the money", () => {
  test("against the budget band", () => {
    expect(rangeFit(5_000, p).call).toBe("small");
    expect(rangeFit(50_000, p).call).toBe("fits");
    expect(rangeFit(2_000_000, p).call).toBe("large");
    expect(rangeFit(null, p).call).toBe("unknown");
    expect(rangeFit(50_000, { ...p, budget_band: null }).why).toContain("Add an annual budget");
  });
  test("reads the top of a written range", () => {
    expect(rangeTop("$10,000 - $50,000")).toBe(50_000);
    expect(rangeTop("$25K to $1.5M")).toBe(1_500_000);
    expect(rangeTop("varies")).toBeNull();
  });
  test("counts the screen's own positive signals", () => {
    expect(signalCount("eligibility text names your organization type; names Kenya; federal opportunity and SAM.gov/UEI is not marked active")).toBe(2);
  });
});

describe("buildFitReport", () => {
  const many = Array.from({ length: 37 }, (_, i) => match({ grant_id: `g${i}`, title: `Call ${i}` }));
  test("has no cap: every lead is in it", () => {
    const r = buildFitReport({ matches: many, funders: [funder({})], leads: [lead({})], eligibility: p, includeRuledOut: true, today: TODAY });
    expect(r.counts.total).toBe(39);
    expect(r.counts.apply).toBe(37);
  });
  test("rows For Granted ruled out are shown to For Granted only", () => {
    const input = { matches: [match({}), match({ grant_id: "g2" })], funders: [], leads: [], eligibility: p, ruledOut: new Set(["grant:g2"]), today: TODAY };
    expect(buildFitReport({ ...input, includeRuledOut: true }).counts.ruled_out).toBe(1);
    const client = buildFitReport({ ...input, includeRuledOut: false });
    expect(client.counts.total).toBe(1);
    expect(client.groups.some(g => g.key === "ruled_out")).toBe(false);
  });
  test("groups in the order of what to do, soonest deadline first", () => {
    const r = buildFitReport({
      matches: [match({ grant_id: "late", close_date: "2027-03-01" }), match({ grant_id: "soon", close_date: "2026-11-10" })],
      funders: [funder({})], leads: [lead({})], eligibility: p, includeRuledOut: false, today: TODAY,
    });
    expect(r.groups.map(g => g.key)).toEqual(["apply", "approach", "research"]);
    expect(r.groups[0].rows.map(x => x.id)).toEqual(["soon", "late"]);
  });
  test("the CSV has a header and one line per lead", () => {
    const r = buildFitReport({ matches: [match({ title: 'Say "hi"' })], funders: [], leads: [], eligibility: p, includeRuledOut: false, today: TODAY });
    const lines = reportCsv(r).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Say ""hi"""');
  });
});
