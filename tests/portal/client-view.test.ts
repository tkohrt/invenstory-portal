/**
 * A client's own view of its matches, and who may start a search (patch 7 of
 * the 1 Nov 2026 build).
 */
import { describe, expect, test } from "vitest";
import { cleanView, viewSentence, selfSearchDecision, CLIENT_DAILY, CLIENT_REASONS, reasonLabel } from "@/lib/client-view";
import { buildFitReport, type MatchInput } from "@/lib/fit-report";
import { EMPTY_PROFILE } from "@/lib/eligibility-fields";

describe("cleanView", () => {
  test("keeps a known reason only on Not for us", () => {
    expect(cleanView({ kind: "grant", targetId: "g1", state: "not_for_us", reason: "wrong_place" }))
      .toEqual({ kind: "grant", targetId: "g1", state: "not_for_us", reason: "wrong_place", note: null });
    expect(cleanView({ kind: "grant", targetId: "g1", state: "interested", reason: "wrong_place" })?.reason).toBeNull();
    expect(cleanView({ kind: "grant", targetId: "g1", state: "not_for_us", reason: "made_up" })?.reason).toBeNull();
  });
  test("refuses unknown kinds, states and empty or huge ids", () => {
    expect(cleanView({ kind: "contact", targetId: "x", state: "interested" })).toBeNull();
    expect(cleanView({ kind: "grant", targetId: "x", state: "maybe" })).toBeNull();
    expect(cleanView({ kind: "grant", targetId: "  ", state: "interested" })).toBeNull();
    expect(cleanView({ kind: "grant", targetId: "x".repeat(401), state: "interested" })).toBeNull();
  });
  test("a note is trimmed and capped", () => {
    expect(cleanView({ kind: "lead", targetId: "l", state: "interested", note: ` ${"a".repeat(400)} ` })?.note).toHaveLength(300);
  });
});

test("reads as a sentence", () => {
  expect(viewSentence({ state: "interested", reason: null })).toBe("Worth a look");
  expect(viewSentence({ state: "not_for_us", reason: "wrong_place" })).toBe("Not for us (not where we work)");
  expect(CLIENT_REASONS.every(r => reasonLabel(r.code))).toBe(true);
});

describe("selfSearchDecision", () => {
  const base = { role: "client" as const, switchOn: true, pageOn: true, usedToday: 0, limit: CLIENT_DAILY.match };
  test("For Granted always may", () => {
    expect(selfSearchDecision({ ...base, role: "admin", switchOn: false, pageOn: false, usedToday: 99 })).toEqual({ ok: true });
  });
  test("a client needs the switch and the page", () => {
    expect(selfSearchDecision({ ...base, switchOn: false }).ok).toBe(false);
    expect(selfSearchDecision({ ...base, pageOn: false }).ok).toBe(false);
    expect(selfSearchDecision(base).ok).toBe(true);
  });
  test("and stops at the day's count", () => {
    expect(selfSearchDecision({ ...base, usedToday: CLIENT_DAILY.match }).ok).toBe(false);
  });
});

describe("in the fit report", () => {
  const m = (id: string): MatchInput => ({ grant_id: id, verdict: "likely", reason: "names Kenya", close_date: "2026-12-15", award_ceiling: null,
    title: id, funder: null, url: null, rationale: null, rationale_source: "pending", verified_at: null });
  test("the client's Not for us leaves their report; For Granted sees what they said", () => {
    const clientViews = new Map([["grant:a", "Worth a look"], ["grant:b", "Not for us (not where we work)"]]);
    const client = buildFitReport({ matches: [m("a"), m("b")], funders: [], leads: [], eligibility: EMPTY_PROFILE,
      ruledOut: new Set(["grant:b"]), clientViews, includeRuledOut: false });
    expect(client.counts.total).toBe(1);
    expect(client.groups[0].rows[0].clientView).toBe("Worth a look");
    const admin = buildFitReport({ matches: [m("a"), m("b")], funders: [], leads: [], eligibility: EMPTY_PROFILE,
      ruledOut: new Set(), clientViews, includeRuledOut: true });
    expect(admin.groups[0].rows.map(r => r.clientView)).toEqual(["Worth a look", "Not for us (not where we work)"]);
  });
});
