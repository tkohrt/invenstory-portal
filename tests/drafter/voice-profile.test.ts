import { describe, expect, it } from "vitest";
import { minimumMet, parseSources, sourceWeight, sourcesChanged, voiceSources, type VoiceSource } from "@/lib/voice-profile";

const base = {
  answers: [{ id: "a1", question: "Describe your program" }],
  documents: [
    { id: "d1", title: "2025 Cleveland Foundation application", type_tag: "past_application", outcome: "won" },
    { id: "d2", title: "2024 Gund application", type_tag: "past_application", outcome: "not_funded" },
    { id: "d3", title: "Gund RFP", type_tag: "funder_form", outcome: null },
    { id: "d4", title: "Past grant application (untagged)", type_tag: null, outcome: null },
  ],
  drafts: [
    { id: "g1", title: "Kresge 2026", status: "won", purpose: "application" },
    { id: "g2", title: "Joyce 2026", status: "submitted", purpose: "application" },
    { id: "g3", title: "Standard Answers", status: "won", purpose: "standard_answers" },
  ],
};

describe("voice profile sources (Auto-Draft patch 4)", () => {
  it("counts approved Standard Answers, tagged past applications and drafts marked Won, and nothing else", () => {
    const ids = voiceSources(base).map(s => s.id);
    expect(ids.sort()).toEqual(["a1", "d1", "d2", "g1"]);
  });

  it("goes by the tag, never the title, so an untagged document or a funder form stays out", () => {
    const ids = voiceSources(base).map(s => s.id);
    expect(ids).not.toContain("d3");
    expect(ids).not.toContain("d4");
  });

  it("marks a Won past application and a draft marked Won as winning, and weighs winning sources double", () => {
    const by = Object.fromEntries(voiceSources(base).map(s => [s.id, s]));
    expect(by.d1.winning).toBe(true);
    expect(by.g1.winning).toBe(true);
    expect(by.d2.winning).toBe(false);
    expect(by.a1.winning).toBe(false);
    expect(sourceWeight(by.d1)).toBe(2);
    expect(sourceWeight(by.a1)).toBe(1);
  });

  it("lists winning sources first, in a stable order", () => {
    expect(voiceSources(base).map(s => s.id)).toEqual(["d1", "g1", "d2", "a1"]);
  });

  describe("the minimum", () => {
    it("is met by one approved Standard Answer or one tagged past application", () => {
      expect(minimumMet([{ kind: "standard_answer" }])).toBe(true);
      expect(minimumMet([{ kind: "past_application" }])).toBe(true);
    });
    it("is not met by nothing, or by a draft marked Won alone", () => {
      expect(minimumMet([])).toBe(false);
      expect(minimumMet([{ kind: "won_draft" }])).toBe(false);
    });
  });

  describe("what changed since the profile was written", () => {
    const saved = voiceSources(base);
    it("is nothing when the sources are the same", () => {
      expect(sourcesChanged(saved, voiceSources(base)).any).toBe(false);
    });
    it("sees a source added and one gone", () => {
      const now = voiceSources({ ...base, answers: [{ id: "a2", question: "Your budget" }] });
      const c = sourcesChanged(saved, now);
      expect(c.added.map(s => s.id)).toEqual(["a2"]);
      expect(c.removed.map(s => s.id)).toEqual(["a1"]);
      expect(c.any).toBe(true);
    });
    it("sees a past application change outcome", () => {
      const now = voiceSources({ ...base, documents: base.documents.map(d => d.id === "d2" ? { ...d, outcome: "won" } : d) });
      const c = sourcesChanged(saved, now);
      expect(c.outcome.map(s => s.id)).toEqual(["d2"]);
      expect(c.added).toEqual([]);
      expect(c.removed).toEqual([]);
    });
  });

  it("reads the stored sources list defensively", () => {
    const ok: VoiceSource = { kind: "past_application", id: "d1", title: "x", winning: true };
    expect(parseSources([ok, { kind: "nope", id: "z" }, null, 3, { kind: "standard_answer" }])).toEqual([ok]);
    expect(parseSources("not a list")).toEqual([]);
    expect(parseSources(null)).toEqual([]);
  });
});
