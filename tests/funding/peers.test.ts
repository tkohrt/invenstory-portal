import { describe, expect, test } from "vitest";
import { cleanPeerOrgs, peerReason, mergePeerEvidence, PEER_MAX, isEin, matchedOrgs, distinctOrgs, peerCheck } from "@/lib/peers";
import type { FunderCard } from "@/lib/ledger-types";

const card = (ein: string, name: string, grantees: string[], reason?: string): FunderCard => ({
  ein, name, match_reason: reason,
  evidence_grantees: grantees.map(n => ({ name: n, total_usd: 50000, latest_year: "2024" })),
});

describe("cleaning the peers a client names", () => {
  test("trims, drops blanks and names too short to search", () => {
    expect(cleanPeerOrgs(["  Boys & Girls   Clubs of Northeast Ohio ", "", "  ", "ab", "YMCA"]))
      .toEqual(["Boys & Girls Clubs of Northeast Ohio", "YMCA"]);
  });
  test("keeps a comma inside a name, and an EIN as typed", () => {
    expect(cleanPeerOrgs(["College Now Greater Cleveland, Inc.", "34-1234567"]))
      .toEqual(["College Now Greater Cleveland, Inc.", "34-1234567"]);
  });
  test("one entry per organization, whatever the capitals", () => {
    expect(cleanPeerOrgs(["Ashoka", "ASHOKA", "ashoka"])).toEqual(["Ashoka"]);
  });
  test("no more than Ground Truth will read", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Organization ${i}`);
    expect(cleanPeerOrgs(many)).toHaveLength(PEER_MAX);
  });
  test("anything that is not a list of text is nothing", () => {
    expect(cleanPeerOrgs("Ashoka")).toEqual([]);
    expect(cleanPeerOrgs(undefined)).toEqual([]);
    expect(cleanPeerOrgs([{ name: "Ashoka" }, 7, null])).toEqual([]);
  });
  test("a very long name is cut, not refused", () => {
    expect(cleanPeerOrgs(["x".repeat(400)])[0]).toHaveLength(160);
  });
});

describe("saying what the evidence is", () => {
  test("names the peers as the client's own, and keeps the grants", () => {
    const f = peerReason(card("1", "Funder", ["Peer A", "Peer B"], "Already funds 2 org(s) like yours: Peer A ($50,000, 2024); Peer B ($50,000, 2024)"));
    expect(f.match_reason).toBe("Already funds 2 of the peers you named: Peer A ($50,000, 2024); Peer B ($50,000, 2024)");
  });
  test("one peer reads as one", () => {
    expect(peerReason(card("1", "Funder", ["Peer A"], "Already funds 1 org(s) like yours: Peer A ($50,000, 2024)")).match_reason)
      .toBe("Already funds a peer you named: Peer A ($50,000, 2024)");
  });
  test("no evidence, no claim", () => {
    const f = card("1", "Funder", [], "Something else");
    expect(peerReason(f)).toBe(f);
  });
});

describe("one evidence list from two questions", () => {
  test("funders of named peers lead, and a funder in both appears once with the named evidence", () => {
    const out = mergePeerEvidence(
      [card("11-1111111", "Shared", ["Peer A"], "Already funds 1 org(s) like yours: Peer A")],
      [card("111111111", "Shared", ["Lookalike"], "Already funds 1 org(s) like yours: Lookalike"), card("222222222", "Other", ["Lookalike"])],
    );
    expect(out.map(f => f.name)).toEqual(["Shared", "Other"]);
    expect(out[0].evidence_grantees?.[0].name).toBe("Peer A");
    expect(out[0].match_reason).toMatch(/^Already funds a peer you named/);
    expect(out[1].match_reason).toBeUndefined();
  });
  test("no peers named leaves the description's evidence exactly as it was", () => {
    const described = [card("222222222", "Other", ["Lookalike"], "Already funds 1 org(s) like yours: Lookalike")];
    expect(mergePeerEvidence([], described)).toEqual(described);
  });
});

// What Ground Truth really answered on 15 November 2026 for each of these.
describe("checking a name against Ground Truth (patch 49)", () => {
  test("an EIN is nine digits, however it is spaced", () => {
    for (const v of ["13-5562976", "135562976", "13 5562976"]) expect(isEin(v)).toBe(true);
    for (const v of ["1355629", "13-5562976 Inc", "Tech Corps", ""]) expect(isEin(v)).toBe(false);
  });
  test("reads the matched names off the wire, and nothing from anything else", () => {
    expect(matchedOrgs({ matched_similar_orgs: ["TECH CORPS OHIO", " TECH  CORPS OHIO ", 7, null] })).toEqual(["TECH CORPS OHIO", "TECH CORPS OHIO"]);
    expect(matchedOrgs({ results: [] })).toEqual([]);
    expect(matchedOrgs(null)).toEqual([]);
  });
  test("two spellings of one name are one organization", () => {
    expect(distinctOrgs(["TECH CORPS OHIO", "Tech Corps Ohio", "Tech Corps Ohio, Inc."])).toEqual(["TECH CORPS OHIO"]);
  });
  test("an EIN that matches is found by name; one that does not is said to be missing", () => {
    expect(peerCheck("13-5562976", ["BOYS AND GIRLS CLUBS OF AMERICA"])).toEqual({ kind: "found", name: "BOYS AND GIRLS CLUBS OF AMERICA", shared: false });
    expect(peerCheck("99-9999999", [])).toEqual({ kind: "missing", ein: true });
  });
  test("a full name that lands on one organization is found", () => {
    expect(peerCheck("Tech Corps Ohio", ["TECH CORPS OHIO", "TECH CORPS OHIO", "TECH CORPS OHIO"]))
      .toEqual({ kind: "found", name: "TECH CORPS OHIO", shared: false });
  });
  test("a partial name that fits one organization is found, and shown as what it matched", () => {
    expect(peerCheck("Envision Excellence in STEM", ["ENVISION EXCELLENCE IN STEM EDUCATION", "Envision Excellence in STEM Education"]))
      .toEqual({ kind: "found", name: "ENVISION EXCELLENCE IN STEM EDUCATION", shared: false });
  });
  test("words that fit several organizations ask which one: the miss that started this patch", () => {
    // Three chapters in other cities; Cleveland's never reached the first three.
    const r = peerCheck("ACE Mentor Program",
      ["ACE MENTOR PROGRAM-GREATER WASHINGTON", "ACE MENTOR PROGRAM OF AMER INC DBA", "ACE MENTOR PROGRAM OF WASHINGTON"],
      ["ACE MENTOR PROGRAM OF CLEVELAND", "ACE MENTOR PROGRAM OF CLEVELAND", "ACE MENTORING"]);
    expect(r.kind).toBe("several");
    expect(r.kind === "several" && r.options).toContain("ACE MENTOR PROGRAM OF CLEVELAND");
    expect(r.kind === "several" && r.options.length).toBeLessThanOrEqual(6);
  });
  test("the exact name typed is found, with a warning when others share its words", () => {
    expect(peerCheck("Open Doors Academy", ["Open Doors Inc aka Open Doors Academy", "OPEN DOORS ACADEMY"]))
      .toEqual({ kind: "found", name: "OPEN DOORS ACADEMY", shared: true });
  });
  test("a name nothing contains offers what is close", () => {
    expect(peerCheck("ace mentor cleveland", [], ["ACE MENTOR PROGRAM OF CLEVELAND", "ACE MENTOR PROGRAM OF CLEVELAND", "ACE MENTORING"]))
      .toEqual({ kind: "suggest", options: ["ACE MENTOR PROGRAM OF CLEVELAND", "ACE MENTORING"] });
  });
  test("nothing exact and nothing close is missing", () => {
    expect(peerCheck("zzqx not a real org", [], [])).toEqual({ kind: "missing", ein: false });
  });
});
